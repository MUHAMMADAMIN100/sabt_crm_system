import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { User, UserRole } from '../users/user.entity';
import { Employee, EmployeeStatus } from '../employees/employee.entity';
import { WorkSession } from './work-session.entity';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { MailService } from '../mail/mail.service';

const mockUserRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockEmployeeRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockSessionRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
});

const mockJwtService = () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
});

const mockActivityLog = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

const mockMailService = () => ({
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let employeeRepo: ReturnType<typeof mockEmployeeRepo>;
  let sessionRepo: ReturnType<typeof mockSessionRepo>;
  let jwtService: ReturnType<typeof mockJwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(Employee), useFactory: mockEmployeeRepo },
        { provide: getRepositoryToken(WorkSession), useFactory: mockSessionRepo },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: ActivityLogService, useFactory: mockActivityLog },
        { provide: MailService, useFactory: mockMailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    employeeRepo = module.get(getRepositoryToken(Employee));
    sessionRepo = module.get(getRepositoryToken(WorkSession));
    jwtService = module.get(JwtService);
  });

  describe('register', () => {
    const dto = { name: 'Test User', email: 'test@example.com', password: 'password123' };

    it('should register a new user and return token', async () => {
      const savedUser = { id: 'user-1', ...dto, role: UserRole.EMPLOYEE };
      userRepo.findOne.mockResolvedValue(null);
      employeeRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockReturnValue(savedUser);
      userRepo.save.mockResolvedValue(savedUser);
      employeeRepo.create.mockReturnValue({ id: 'emp-1' });
      employeeRepo.save.mockResolvedValue({ id: 'emp-1' });

      const result = await service.register(dto);

      expect(userRepo.findOne).toHaveBeenCalledWith({ where: { email: dto.email } });
      expect(userRepo.save).toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalled();
      expect(result).toHaveProperty('token', 'mock-jwt-token');
      expect(result.user).not.toHaveProperty('password');
    });

    it('should throw ConflictException if email already exists', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'existing', email: dto.email });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('should link existing employee record when email matches', async () => {
      const savedUser = { id: 'user-1', ...dto, role: UserRole.EMPLOYEE };
      const existingEmployee = { id: 'emp-1', email: dto.email, userId: null, save: jest.fn() };
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockReturnValue(savedUser);
      userRepo.save.mockResolvedValue(savedUser);
      employeeRepo.findOne.mockResolvedValue(existingEmployee);
      employeeRepo.save.mockResolvedValue({ ...existingEmployee, userId: 'user-1' });

      await service.register(dto);

      expect(employeeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException for invalid credentials', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'wrong@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const user = {
        id: 'user-1',
        email: 'test@example.com',
        role: UserRole.EMPLOYEE,
        isActive: true,
        validatePassword: jest.fn().mockResolvedValue(false),
      };
      userRepo.findOne.mockResolvedValue(user);
      employeeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return token on successful login', async () => {
      const user = {
        id: 'user-1',
        name: 'Test',
        email: 'test@example.com',
        role: UserRole.EMPLOYEE,
        isActive: true,
        password: 'hashed',
        validatePassword: jest.fn().mockResolvedValue(true),
      };
      userRepo.findOne.mockResolvedValue(user);
      employeeRepo.findOne.mockResolvedValue({ isSubAdmin: false });
      sessionRepo.create.mockReturnValue({ userId: 'user-1' });
      sessionRepo.save.mockResolvedValue({ id: 'session-1' });

      const result = await service.login({ email: 'test@example.com', password: 'correct' });

      expect(result).toHaveProperty('token', 'mock-jwt-token');
      expect(result.user).not.toHaveProperty('password');
    });
  });

  describe('sanitize (via register)', () => {
    it('should not expose password or reset tokens in returned user', async () => {
      const savedUser = {
        id: 'user-1',
        name: 'Test',
        email: 'test@example.com',
        password: 'hashed-password',
        resetPasswordToken: 'some-token',
        resetPasswordExpires: new Date(),
        role: UserRole.EMPLOYEE,
      };
      userRepo.findOne.mockResolvedValue(null);
      employeeRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockReturnValue(savedUser);
      userRepo.save.mockResolvedValue(savedUser);
      employeeRepo.create.mockReturnValue({});
      employeeRepo.save.mockResolvedValue({});

      const result = await service.register({
        name: 'Test',
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('resetPasswordToken');
      expect(result.user).not.toHaveProperty('resetPasswordExpires');
    });
  });
});
