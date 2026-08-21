import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import { Response } from 'express';

/**
 * Загрузка файла крупнее лимита приходила к человеку как «File too large» —
 * английская строка из multer, по которой непонятно ни что случилось, ни что
 * делать. Отвечаем по-русски и кодом 400: для интерфейса это обычная ошибка
 * ввода, а не сбой, и её текст видно в уведомлении.
 */
@Catch(PayloadTooLargeException)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: 400,
      message: 'Файл слишком большой. Выберите изображение поменьше или сожмите его.',
    });
  }
}
