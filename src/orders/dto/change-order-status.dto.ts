import { Order, OrderStatus } from "@prisma/client";
import { IsEnum, IsUUID } from "class-validator";
import { OrderStatusList } from "src/orders/enum/order.enum";

export class ChangeOrderStatusDto {

    @IsUUID(4)
    id: string;

    @IsEnum(OrderStatusList,{
        message: `Posibles valores ${ OrderStatusList}`
    })
    status: OrderStatus;
}