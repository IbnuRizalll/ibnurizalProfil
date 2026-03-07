import { PrismaClient } from '@prisma/client'

declare global {
  var __prismaServerClient: PrismaClient | undefined
}

export function getPrismaServerClient(): PrismaClient {
  if (!globalThis.__prismaServerClient) {
    globalThis.__prismaServerClient = new PrismaClient()
  }
  return globalThis.__prismaServerClient
}
