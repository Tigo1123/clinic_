import {
  PipeTransform,
  Injectable,
  Optional,
  UnprocessableEntityException,
  ArgumentMetadata,
} from '@nestjs/common';
import { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(@Optional() private schema?: ZodSchema) {}

  transform(value: unknown, _metadata?: ArgumentMetadata) {
    if (!this.schema) {
      return value;
    }

    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new UnprocessableEntityException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: (result.error.issues || []).map((e: any) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
      });
    }

    return result.data;
  }
}
