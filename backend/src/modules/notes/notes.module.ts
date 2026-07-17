import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonalNote } from './personal-note.entity';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PersonalNote])],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
