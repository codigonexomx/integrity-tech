import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;
  private readonly blindIndexSalt: string;

  constructor() {
    // 32 bytes (256 bits) para la clave de cifrado simétrico
    const keyEnv = process.env.ENCRYPTION_KEY;
    if (process.env.NODE_ENV === 'production' && (!/^[a-fA-F0-9]{64}$/.test(keyEnv || '') || (process.env.HMAC_SALT || '').length < 32)) {
      throw new Error('ENCRYPTION_KEY hexadecimal de 32 bytes y HMAC_SALT de al menos 32 caracteres son obligatorios en producción.');
    }
    if (keyEnv && /^[a-fA-F0-9]{64}$/.test(keyEnv)) {
      this.key = Buffer.from(keyEnv, 'hex');
    } else {
      this.logger.warn('DATABASE ENCRYPTION_KEY no configurada o inválida. Usando clave de desarrollo local (insegura).');
      this.key = Buffer.alloc(32, 'd'); // 32 bytes de 'd'
    }

    // Sal para blind indexing (HMAC-SHA256)
    this.blindIndexSalt = process.env.HMAC_SALT || 'development-blind-index-salt-54321';
  }

  /**
   * Cifra una cadena de texto usando AES-256-GCM.
   * Retorna una cadena con formato iv:authTag:ciphertext
   */
  encrypt(text: string): string {
    if (!text) return text;
    try {
      const iv = crypto.randomBytes(12); // GCM estándar usa 12 bytes de IV
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag().toString('hex');
      
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
      this.logger.error(`Error de cifrado: ${err.message}`);
      throw new Error('Error al cifrar datos personales.');
    }
  }

  /**
   * Descifra una cadena con formato iv:authTag:ciphertext usando AES-256-GCM.
   */
  decrypt(encryptedText: string): string {
    if (!encryptedText) return encryptedText;
    
    // Si no contiene los separadores del formato iv:authTag:ciphertext, asumimos que no está cifrado
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      return encryptedText;
    }

    try {
      const [ivHex, authTagHex, ciphertextHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const ciphertext = Buffer.from(ciphertextHex, 'hex');
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString('utf8');
    } catch (err) {
      this.logger.error(`Error de descifrado: ${err.message}`);
      // En caso de falla, retornamos el texto original para resiliencia en migración
      return encryptedText;
    }
  }

  /**
   * Genera un Blind Index determinista usando HMAC-SHA256
   * para posibilitar búsquedas exactas sobre campos cifrados.
   */
  generateBlindIndex(text: string): string {
    if (!text) return text;
    const normalized = text.trim().toLowerCase();
    return crypto
      .createHmac('sha256', this.blindIndexSalt)
      .update(normalized)
      .digest('hex');
  }
}
