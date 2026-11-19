-- CreateEnum
CREATE TYPE "AlertRuleType" AS ENUM ('DEVICE_OFFLINE', 'DEVICE_ONLINE', 'ROUTER_OFFLINE', 'COLLECTOR_DISCONNECTED', 'HIGH_LATENCY', 'HIGH_PACKET_LOSS', 'HIGH_BANDWIDTH', 'NETWORK_UNAVAILABLE', 'MONITORING_FAILURE');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK', 'TELEGRAM', 'DISCORD');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "disabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Collector" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "tokenRotatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN     "cooldownSec" INTEGER NOT NULL DEFAULT 900,
ADD COLUMN     "deviceId" UUID,
ADD COLUMN     "evalIntervalSec" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "lastEvaluatedAt" TIMESTAMP(3),
ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "routerId" UUID,
ADD COLUMN     "threshold" DOUBLE PRECISION,
ADD COLUMN     "type" "AlertRuleType",
ADD COLUMN     "windowMin" INTEGER NOT NULL DEFAULT 10,
ALTER COLUMN "condition" SET DEFAULT '{}';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "collectorId" UUID,
ADD COLUMN     "fingerprint" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "networkId" UUID,
ADD COLUMN     "routerId" UUID,
ADD COLUMN     "value" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" UUID NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minSeverity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "alertId" UUID,
    "channelId" UUID,
    "userId" UUID,
    "type" "NotificationChannelType" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'triggered',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "status" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceHeartbeat" (
    "service" TEXT NOT NULL,
    "version" TEXT,
    "hostname" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,
    "info" JSONB,

    CONSTRAINT "ServiceHeartbeat_pkey" PRIMARY KEY ("service")
);

-- CreateIndex
CREATE INDEX "Notification_type_readAt_createdAt_idx" ON "Notification"("type", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_alertId_idx" ON "Notification"("alertId");

-- CreateIndex
CREATE INDEX "BackupRecord_startedAt_idx" ON "BackupRecord"("startedAt");

-- CreateIndex
CREATE INDEX "DeviceObservation_observedAt_idx" ON "DeviceObservation"("observedAt");

-- CreateIndex
CREATE INDEX "DeviceMetric_timestamp_idx" ON "DeviceMetric"("timestamp");

-- CreateIndex
CREATE INDEX "NetworkEvent_networkId_occurredAt_idx" ON "NetworkEvent"("networkId", "occurredAt");

-- CreateIndex
CREATE INDEX "Alert_fingerprint_state_idx" ON "Alert"("fingerprint", "state");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_idx" ON "Alert"("resolvedAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

