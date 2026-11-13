import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import path from 'node:path';
import { UploadService, UploadedMulterFile } from './upload.service.js';
import { PolicyRoles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @PolicyRoles('ADMIN', 'RECEPTIONIST', 'DOCTOR', 'LAB_TECH')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024),
        files: 1,
      },
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  async upload(@UploadedFile() file: UploadedMulterFile) {
    return this.uploadService.validateAndSaveFile(file);
  }

  @Get(':filename')
  @HttpCode(HttpStatus.OK)
  async getFile(
    @Param('filename') filename: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const resolvedPath = await this.uploadService.getAuthorizedFilePath(filename, user);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(resolvedPath);
  }
}
