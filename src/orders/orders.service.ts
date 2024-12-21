import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { CONSOLE_COLORS } from 'colors.constants';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from 'src/orders/dto/change-order-status.dto';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';
import { OrderWithProducts } from './interfaces/order-with-produts.interface';
import { PaidOrderDto } from './dto';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger(`${CONSOLE_COLORS.TEXT.MAGENTA}OrdersService`);

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`${CONSOLE_COLORS.TEXT.CYAN}Connected to database`);
  }

  async create(createOrderDto: CreateOrderDto) {
    
    try {

      //1 - Validar que los productos existen
      const productIds = createOrderDto.items.map((item) => item.productId);
      const products: any[] =  await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds),
      );

      //2 calculos de los valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find((product) => product.id === orderItem.productId).price;
        return price * orderItem.quantity + acc;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      //3 - Insertar orden en la base de datos -- transaccion
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany:{
              data: createOrderDto.items.map((orderItem) => ({
                productId: orderItem.productId,
                quantity: orderItem.quantity,
                price: products.find((product) => product.id === orderItem.productId).price,
              }))
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              productId: true,
              quantity: true,
              price: true,
            }
          }
        }
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find((product) => product.id === orderItem.productId).name,
        }))
      }

    } catch (error) {
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Revisar logs'
      });
    }
    
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {

    const { page, limit } = orderPaginationDto;
    
    const items = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });
      
    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: {
          status: orderPaginationDto.status
        },
      }),
      meta: {
        items: items,
        page: page,
        totalPages: Math.ceil(items / limit),
      }
    };
  }

  async findOne(id: string) {

    const order = await this.order.findFirst({
      where: { id },
      include: {
        OrderItem: {
          select: {
            productId: true,
            quantity: true,
            price: true,
          }
        }
      }
    });

    if (!order) {
      throw new RpcException({ 
        status: HttpStatus.NOT_FOUND,
        message: `Orden con ${id} no encontrada`,
      })
    }

    const productIds = order.OrderItem.map((orderItem) => orderItem.productId);
    const products: any[] =  await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map((orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId).name,
      }))
    }
  }

  async changeStatus(changeOrderStatus: ChangeOrderStatusDto) {
    
    const { id, status } = changeOrderStatus;

    const order = await this.findOne(id);
    if ( order.status === status ) {
      return order;
    }

    return this.order.update({
      where: { id },
      data: { status: status }
    });
  }

  async createPaymentSession(order: OrderWithProducts) {

    const paymentSession = await firstValueFrom(
      this.client.send('create.payment.session', {
        orderId: order.id,
        currency: 'usd',
        items: order.OrderItem.map( item => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        }) ),
      }),
    );

    return paymentSession;
  }

  async paidOrder( paidOrderDto: PaidOrderDto ) {

    this.logger.log('Order Paid');
    this.logger.log(paidOrderDto);

    const order = await this.order.update({
      where: { id: paidOrderDto.orderId },
      data: {
        status: 'PAID',
        paid: true,
        paidAt: new Date(),
        stripeChargeId: paidOrderDto.stripePaymentId,

        // La relación
        OrderReceipt: {
          create: {
            receiptUrl: paidOrderDto.receiptUrl
          }
        }
      }
    });

    return order;

  }
}
