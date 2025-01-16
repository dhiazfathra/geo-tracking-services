import { Controller, Get, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  async getTimelineData() {
    return this.timelineService.getHistoryTimeLine();
  }

  @Get('detail')
  async getTimelineDetail(@Query('timelineId') timelineId: string) {
    return this.timelineService.detailTimeLine(timelineId);
  }
}
