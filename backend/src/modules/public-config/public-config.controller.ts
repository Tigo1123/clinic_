import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppConfigService } from '../config/config.service.js';

@Public()
@Controller('public-config')
export class PublicConfigController {
  constructor(private readonly configService: AppConfigService) {}

  @Get()
  getPublicConfig() {
    const branding = this.configService.facilityBranding;
    return {
      clinicTimeZone: this.configService.clinicTimeZone,
      productNameAr: branding.productNameAr,
      productNameEn: branding.productNameEn,
      productDescriptorAr: branding.productDescriptorAr,
      productDescriptorEn: branding.productDescriptorEn,
      facilityNameAr: branding.facilityNameAr,
      facilityNameEn: branding.facilityNameEn,
      displayNameAr: branding.displayNameAr,
      displayNameEn: branding.displayNameEn,
    };
  }
}
