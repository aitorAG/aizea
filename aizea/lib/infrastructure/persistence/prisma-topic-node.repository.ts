// PrismaTopicNodeRepository — concrete implementation of ITopicNodeRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ITopicNodeRepository, TopicNodeRow } from "@/lib/application/ports/topic-node-repository.port";

export class PrismaTopicNodeRepository implements ITopicNodeRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findByCourseId(courseId: string): Promise<TopicNodeRow[]> {
    return this.prisma.topicNode.findMany({ where: { courseId } }) as Promise<TopicNodeRow[]>;
  }

  async findById(id: string): Promise<TopicNodeRow | null> {
    return this.prisma.topicNode.findUnique({ where: { id } }) as Promise<TopicNodeRow | null>;
  }

  async create(data: Omit<TopicNodeRow, "id" | "createdAt" | "updatedAt">): Promise<TopicNodeRow> {
    return this.prisma.topicNode.create({ data }) as Promise<TopicNodeRow>;
  }

  async createMany(data: Omit<TopicNodeRow, "id" | "createdAt" | "updatedAt">[]): Promise<void> {
    await this.prisma.topicNode.createMany({ data });
  }

  async update(id: string, data: Partial<TopicNodeRow>): Promise<TopicNodeRow> {
    return this.prisma.topicNode.update({ where: { id }, data }) as Promise<TopicNodeRow>;
  }

  async updateMany(ids: string[], data: Partial<TopicNodeRow>): Promise<void> {
    await this.prisma.topicNode.updateMany({ where: { id: { in: ids } }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.topicNode.delete({ where: { id } });
  }

  async deleteMany(ids: string[]): Promise<void> {
    await this.prisma.topicNode.deleteMany({ where: { id: { in: ids } } });
  }

  async countByCourseId(courseId: string): Promise<number> {
    return this.prisma.topicNode.count({ where: { courseId } });
  }
}
