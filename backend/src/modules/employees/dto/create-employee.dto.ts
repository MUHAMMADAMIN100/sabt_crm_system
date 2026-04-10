import { IsString, IsEmail, IsOptional, IsEnum, IsDateString, IsNumber } from 'class-validator';
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
  @ApiProperty() @IsDateString() hireDate: string;
  @ApiProperty({ enum: EmployeeStatus, required: false }) @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus;
  @ApiProperty({ required: false }) @IsOptional() @IsString() bio?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() salary?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() userId?: string;
  @ApiProperty({ enum: UserRole, required: false }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
