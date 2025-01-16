-- AddForeignKey
ALTER TABLE "TimeLine" ADD CONSTRAINT "TimeLine_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
