import { IsString, IsEmail, IsOptional, IsEnum, IsDateString, IsNumber, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EmployeeStatus } from '../employee.entity';
import { UserRole } from '../../users/user.entity';
import { PartialType } from '@nestjs/mapped-types';

export class CreateEmployeeDto {
  @ApiProperty() @IsString() fullName: string;
  @ApiProperty() @IsString() position: string;
  @ApiProperty() @IsString() department: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() phone?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() telegram?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() instagram?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() birthDate?: string;
  @ApiProperty() @IsDateString() hireDate: string;
  @ApiProperty({ enum: EmployeeStatus, required: false }) @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
  /** Отпуск «с — по» — при статусе «В отпуске». */
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() vacationFrom?: string | null;
  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsDateString() vacationUntil?: string | null;
  /** Оплачиваемый отпуск или за свой счёт. */
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() vacationPaid?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() bio?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() salary?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userId?: string;
  @ApiProperty({ enum: UserRole, required: false }) @IsOptional() @IsEnum(UserRole) role?: UserRole;

  /** Вторая (дополнительная) роль — например видеограф + монтажёр.
   *  Назначается только admin/founder/co_founder. Пустая строка — снять.
   *  Валидация значения (членство в enum, не привилегированная, не равна
   *  основной) — в сервисе; здесь только строка, чтобы '' проходила. */
  @ApiProperty({ enum: UserRole, required: false })
  @IsOptional()
  @IsString()
  secondaryRole?: UserRole | '' | null;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
