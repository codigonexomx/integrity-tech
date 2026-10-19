import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(async () => {
    // Definimos variables de entorno mockeadas
    process.env.ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'; // 32 bytes hex
    process.env.HMAC_SALT = 'test-salt-secret';

    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService],
    }).compile();

    service = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => { delete process.env.ENCRYPTION_KEY; delete process.env.HMAC_SALT; });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  it('debe cifrar y descifrar texto correctamente usando AES-256-GCM', () => {
    const originalText = 'juan.perez@example.com';
    const encrypted = service.encrypt(originalText);
    
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(originalText);
    expect(encrypted.split(':').length).toBe(3); // iv:authTag:ciphertext

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(originalText);
  });

  it('debe retornar el texto original si se intenta descifrar un formato inválido', () => {
    const plainText = 'texto_no_cifrado';
    const decrypted = service.decrypt(plainText);
    expect(decrypted).toBe(plainText);
  });

  it('debe generar un blind index determinista', () => {
    const text1 = '  JUAN.perez@example.com  ';
    const text2 = 'juan.perez@example.com';
    
    const index1 = service.generateBlindIndex(text1);
    const index2 = service.generateBlindIndex(text2);
    
    expect(index1).toBe(index2);
    expect(index1).toHaveLength(64); // SHA-256 es de 64 caracteres en hex
  });
});
