import { Module } from '@nestjs/common';
import { MetaWebhookController } from './meta-webhook.controller';

@Module({
  controllers: [MetaWebhookController],
})
export class MetaWebhookModule {}
