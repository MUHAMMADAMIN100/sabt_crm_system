import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum TeamStoryKind {
  PHOTO = 'photo',
  VIDEO = 'video',
}

/**
 * Сторис сотрудника во внутренней «Ленте команды».
 *
 * Не путать с модулем stories: там story_logs — счётчик сторис, которые
 * СММ-команда публикует КЛИЕНТАМ. Здесь речь о ленте для своих.
 *
 * Сама картинка или видео лежит отдельной таблицей (team_story_media):
 * список ленты запрашивается часто, и тянуть вместе с ним мегабайты
 * нельзя. Медиа отдаётся по ссылке и кэшируется браузером.
 */
@Entity('team_stories')
export class TeamStory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: User;

  @Column({ type: 'varchar', default: TeamStoryKind.PHOTO })
  kind: TeamStoryKind;

  @Column({ type: 'varchar', length: 500, default: '' })
  caption: string;

  /** Случайный ключ ссылки на медиа. Отдельно от id: по ссылке нельзя
   *  перебрать чужие сторис, а ручка отдачи работает без авторизации —
   *  тег <img>/<video> не умеет слать заголовок Authorization. */
  @Index({ unique: true })
  @Column({ type: 'varchar' })
  mediaKey: string;

  @Column({ type: 'varchar' })
  mediaMime: string;

  @Column({ type: 'int', default: 0 })
  mediaSize: number;

  /** Длительность видео в секундах. Для фото — 0. */
  @Column({ type: 'int', default: 0 })
  durationSec: number;

  /** Когда сторис уходит из ленты. Считается при создании. */
  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Байты медиа. Отдельная таблица — чтобы обычные выборки её не касались. */
@Entity('team_story_media')
export class TeamStoryMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  storyId: string;

  /** bytea, а не base64-текст: кодирование раздуло бы видео на треть. */
  @Column({ type: 'bytea' })
  data: Buffer;
}

/** Кто посмотрел сторис. Пара (сторис, зритель) уникальна. */
@Entity('team_story_views')
@Index(['storyId', 'userId'], { unique: true })
export class TeamStoryView {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  storyId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** Реакция. От одного человека — одна: повторный тап меняет или снимает. */
@Entity('team_story_reactions')
@Index(['storyId', 'userId'], { unique: true })
export class TeamStoryReaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  storyId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 8 })
  emoji: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

@Entity('team_story_comments')
export class TeamStoryComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  storyId: string;

  @Column({ type: 'uuid' })
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'authorId' })
  author: User;

  @Column({ type: 'varchar', length: 1000 })
  text: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
