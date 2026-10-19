import { Readable } from 'stream';
import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutPrivateObjectInput, PutPrivateObjectResult, StorageProvider } from '../storage-provider.interface';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  private readonly bucket = process.env.STORAGE_S3_BUCKET || '';
  private clientInstance?: S3Client;
  private get client(): S3Client {
    return this.clientInstance ||= new S3Client({
    region: process.env.STORAGE_S3_REGION,
    endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.STORAGE_S3_ENDPOINT),
    credentials: {
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY || '',
    },
    });
  }

  async putObject(input: PutPrivateObjectInput): Promise<PutPrivateObjectResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.mimeType,
        Metadata: {
          classification: input.classification,
        },
      }),
    );
    return {
      storageProvider: this.name,
      bucket: this.bucket,
      objectKey: input.objectKey,
    };
  }

  async getObjectStream(objectKey: string): Promise<Readable> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    return result.Body as Readable;
  }

  getSignedUrl(objectKey: string, ttlSeconds: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), {
      expiresIn: ttlSeconds,
    });
  }

  async healthCheck() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { status: 'up' as const };
    } catch (error) {
      return { status: 'down' as const, message: error.message };
    }
  }
}
