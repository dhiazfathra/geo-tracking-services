import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistoryTimeLine() {
    try {
      const data = await this.prisma.timeLine.findMany({
        where: {
          endTime: { not: null },
        },
        include: {
          Device: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return {
        statusCode: HttpStatus.OK,
        success: true,
        message: 'Data berhasil diambil',
        data,
      };
    } catch (error) {
      throw error;
    }
  }

  async detailTimeLine(timelineId: string) {
    try {
      const data = await this.prisma.location.findMany({
        where: {
          timeLineId: timelineId,
        },

        orderBy: { createdAt: 'asc' },
      });
      return {
        statusCode: HttpStatus.OK,
        success: true,
        message: 'Data berhasil diambil',
        data,
      };
    } catch (error) {
      throw error;
    }
  }
}
