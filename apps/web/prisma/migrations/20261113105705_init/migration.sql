-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('MAC', 'HOSTNAME', 'SERIAL', 'MDNS_NAME', 'DHCP_CLIENT_ID', 'SNMP_SYSNAME', 'VENDOR_ID');

-- CreateEnum
CREATE TYPE "AddressFamily" AS ENUM ('IPV4', 'IPV6');

-- CreateEnum
CREATE TYPE "CollectorStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "RouterIntegrationMethod" AS ENUM ('NONE', 'ICMP', 'SNMP_V2C', 'SNMP_V3', 'DLINK_HNAP', 'HTTP_PROBE');

-- CreateEnum
CREATE TYPE "RouterIntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED', 'PARTIAL', 'UNSUPPORTED', 'AUTH_FAILED', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "CapabilityState" AS ENUM ('SUPPORTED', 'UNSUPPORTED', 'UNTESTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'DISPATCHED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscoveryMethod" AS ENUM ('ARP', 'ICMP', 'NMAP', 'DHCP', 'MANUAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AlertRuleType" AS ENUM ('DEVICE_OFFLINE', 'DEVICE_ONLINE', 'ROUTER_OFFLINE', 'COLLECTOR_DISCONNECTED', 'HIGH_LATENCY', 'HIGH_PACKET_LOSS', 'HIGH_BANDWIDTH', 'NETWORK_UNAVAILABLE', 'MONITORING_FAILURE');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('IN_APP', 'EMAIL', 'WEBHOOK', 'TELEGRAM', 'DISCORD');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MonitorTaskStatus" AS ENUM ('PENDING', 'DISPATCHED', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TrafficSourceKind" AS ENUM ('SNMP_IF_COUNTERS', 'ROUTER_CLIENT_STATS', 'NETFLOW_V5', 'IPFIX', 'SFLOW', 'PACKET_CAPTURE');

-- CreateEnum
CREATE TYPE "TrafficSourceStatus" AS ENUM ('ACTIVE', 'STALE', 'UNSUPPORTED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "TrafficScope" AS ENUM ('INTERFACE', 'DEVICE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "lastLoginAt" TIMESTAMP(3),
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Network" (
    "id" UUID NOT NULL,
    "offlineThreshold" INTEGER NOT NULL DEFAULT 3,
    "monitorIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "pingCount" INTEGER NOT NULL DEFAULT 4,
    "lastMonitoredAt" TIMESTAMP(3),
    "context" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "parentId" UUID,
    "vlanId" INTEGER,
    "gateway" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collector" (
    "id" UUID NOT NULL,
    "networkId" UUID,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenRotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "status" "CollectorStatus" NOT NULL DEFAULT 'PENDING',
    "version" TEXT,
    "hostname" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastScanAt" TIMESTAMP(3),
    "lastScanStatus" "ScanStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "displayName" TEXT,
    "hostname" TEXT,
    "vendor" TEXT,
    "deviceType" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "icmpBlocked" BOOLEAN NOT NULL DEFAULT false,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessfulAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "lastCollectorId" UUID,
    "mergedIntoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceIdentifier" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAddress" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "address" INET NOT NULL,
    "family" "AddressFamily" NOT NULL DEFAULT 'IPV4',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceObservation" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "collectorId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "method" "DiscoveryMethod" NOT NULL,
    "scanJobId" UUID,
    "ipAddress" INET,
    "macAddress" TEXT,
    "hostname" TEXT,
    "reachable" BOOLEAN NOT NULL,
    "latencyMs" DOUBLE PRECISION,
    "data" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Router" (
    "id" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "deviceId" UUID,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "firmware" TEXT,
    "managementIp" INET,
    "lanIp" INET,
    "wanIp" INET,
    "wanUp" BOOLEAN,
    "uptimeSec" BIGINT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "integrationMethod" "RouterIntegrationMethod" NOT NULL DEFAULT 'ICMP',
    "integrationStatus" "RouterIntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "integrationError" TEXT,
    "credentialsEnc" TEXT,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "assignedCollectorId" UUID,
    "lastPolledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Router_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterInterface" (
    "id" UUID NOT NULL,
    "routerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ifIndex" INTEGER,
    "macAddress" TEXT,
    "speedMbps" INTEGER,
    "isUp" BOOLEAN,
    "role" TEXT NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterInterface_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DHCPLease" (
    "id" UUID NOT NULL,
    "routerId" UUID,
    "collectorId" UUID,
    "deviceId" UUID,
    "macAddress" TEXT NOT NULL,
    "address" INET NOT NULL,
    "hostname" TEXT,
    "connectionType" TEXT,
    "lastReportedAt" TIMESTAMP(3),
    "leaseStart" TIMESTAMP(3) NOT NULL,
    "leaseEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DHCPLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceMetric" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterfaceMetric" (
    "id" UUID NOT NULL,
    "interfaceId" UUID NOT NULL,
    "rxBytes" BIGINT,
    "txBytes" BIGINT,
    "rxBps" DOUBLE PRECISION,
    "txBps" DOUBLE PRECISION,
    "errors" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterfaceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficFlow" (
    "id" UUID NOT NULL,
    "collectorId" UUID,
    "interfaceId" UUID,
    "srcAddress" INET NOT NULL,
    "dstAddress" INET NOT NULL,
    "srcPort" INTEGER,
    "dstPort" INTEGER,
    "protocol" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "packets" BIGINT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkEvent" (
    "id" UUID NOT NULL,
    "networkId" UUID,
    "deviceId" UUID,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "data" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" UUID NOT NULL,
    "networkId" UUID,
    "name" TEXT NOT NULL,
    "type" "AlertRuleType",
    "deviceId" UUID,
    "routerId" UUID,
    "threshold" DOUBLE PRECISION,
    "windowMin" INTEGER NOT NULL DEFAULT 10,
    "evalIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "cooldownSec" INTEGER NOT NULL DEFAULT 900,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "ruleId" UUID,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "deviceId" UUID,
    "networkId" UUID,
    "routerId" UUID,
    "collectorId" UUID,
    "severity" "AlertSeverity" NOT NULL,
    "state" "AlertState" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "details" JSONB,
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorNetwork" (
    "collectorId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectorNetwork_pkey" PRIMARY KEY ("collectorId","networkId")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "collectorId" UUID,
    "requestedById" UUID,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "hostsTotal" INTEGER,
    "hostsScanned" INTEGER NOT NULL DEFAULT 0,
    "devicesFound" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceStatusTransition" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "fromStatus" "DeviceStatus" NOT NULL,
    "toStatus" "DeviceStatus" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceStatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterNetwork" (
    "routerId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouterNetwork_pkey" PRIMARY KEY ("routerId","networkId")
);

-- CreateTable
CREATE TABLE "RouterCapability" (
    "id" UUID NOT NULL,
    "routerId" UUID NOT NULL,
    "capability" TEXT NOT NULL,
    "state" "CapabilityState" NOT NULL DEFAULT 'UNTESTED',
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterMetric" (
    "id" UUID NOT NULL,
    "routerId" UUID NOT NULL,
    "reachable" BOOLEAN NOT NULL,
    "latencyMs" DOUBLE PRECISION,
    "uptimeSec" BIGINT,
    "clientCount" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouterMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorTask" (
    "id" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "collectorId" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "MonitorTaskStatus" NOT NULL DEFAULT 'PENDING',
    "targets" JSONB NOT NULL,
    "pingCount" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatencyMeasurement" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "collectorId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "monitorTaskId" UUID,
    "targetIp" INET NOT NULL,
    "sent" INTEGER NOT NULL,
    "received" INTEGER NOT NULL,
    "minMs" DOUBLE PRECISION,
    "avgMs" DOUBLE PRECISION,
    "maxMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LatencyMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatencyRollup" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "samples" INTEGER NOT NULL,
    "upSamples" INTEGER NOT NULL,
    "avgMs" DOUBLE PRECISION,
    "minMs" DOUBLE PRECISION,
    "maxMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LatencyRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkHealthSnapshot" (
    "id" UUID NOT NULL,
    "networkId" UUID,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "devicesTotal" INTEGER NOT NULL,
    "online" INTEGER NOT NULL,
    "offline" INTEGER NOT NULL,
    "unknown" INTEGER NOT NULL,
    "routersTotal" INTEGER NOT NULL,
    "routersUp" INTEGER NOT NULL,
    "collectorsTotal" INTEGER NOT NULL,
    "collectorsUp" INTEGER NOT NULL,
    "avgLatencyMs" DOUBLE PRECISION,
    "packetLoss" DOUBLE PRECISION,
    "healthScore" DOUBLE PRECISION,

    CONSTRAINT "NetworkHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobFailure" (
    "id" UUID NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT,
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT NOT NULL,
    "data" JSONB,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopologyNodePosition" (
    "nodeId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopologyNodePosition_pkey" PRIMARY KEY ("nodeId")
);

-- CreateTable
CREATE TABLE "TrafficSource" (
    "id" UUID NOT NULL,
    "kind" "TrafficSourceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "routerId" UUID,
    "collectorId" UUID,
    "perDevice" BOOLEAN NOT NULL DEFAULT false,
    "status" "TrafficSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "detail" TEXT,
    "lastSampleAt" TIMESTAMP(3),
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficSample" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "scope" "TrafficScope" NOT NULL,
    "interfaceId" UUID,
    "deviceId" UUID,
    "routerId" UUID,
    "networkId" UUID,
    "countsTowardTotal" BOOLEAN NOT NULL DEFAULT false,
    "downloadBytes" BIGINT NOT NULL,
    "uploadBytes" BIGINT NOT NULL,
    "downloadBps" DOUBLE PRECISION NOT NULL,
    "uploadBps" DOUBLE PRECISION NOT NULL,
    "utilization" DOUBLE PRECISION,
    "intervalSec" DOUBLE PRECISION NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficRollup" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "TrafficScope" NOT NULL,
    "sourceId" UUID NOT NULL,
    "deviceId" UUID,
    "interfaceId" UUID,
    "routerId" UUID,
    "networkId" UUID,
    "countsTowardTotal" BOOLEAN NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "downloadBytes" BIGINT NOT NULL,
    "uploadBytes" BIGINT NOT NULL,
    "maxDownloadBps" DOUBLE PRECISION NOT NULL,
    "maxUploadBps" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,

    CONSTRAINT "TrafficRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Network_parentId_idx" ON "Network"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Network_context_cidr_key" ON "Network"("context", "cidr");

-- CreateIndex
CREATE UNIQUE INDEX "Collector_name_key" ON "Collector"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Collector_tokenHash_key" ON "Collector"("tokenHash");

-- CreateIndex
CREATE INDEX "Collector_networkId_idx" ON "Collector"("networkId");

-- CreateIndex
CREATE INDEX "Collector_status_idx" ON "Collector"("status");

-- CreateIndex
CREATE INDEX "Device_networkId_status_idx" ON "Device"("networkId", "status");

-- CreateIndex
CREATE INDEX "Device_lastSeenAt_idx" ON "Device"("lastSeenAt");

-- CreateIndex
CREATE INDEX "DeviceIdentifier_deviceId_idx" ON "DeviceIdentifier"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceIdentifier_type_value_key" ON "DeviceIdentifier"("type", "value");

-- CreateIndex
CREATE INDEX "DeviceAddress_deviceId_validFrom_idx" ON "DeviceAddress"("deviceId", "validFrom");

-- CreateIndex
CREATE INDEX "DeviceAddress_networkId_address_idx" ON "DeviceAddress"("networkId", "address");

-- CreateIndex
CREATE INDEX "DeviceAddress_address_validTo_idx" ON "DeviceAddress"("address", "validTo");

-- CreateIndex
CREATE INDEX "DeviceObservation_deviceId_observedAt_idx" ON "DeviceObservation"("deviceId", "observedAt");

-- CreateIndex
CREATE INDEX "DeviceObservation_collectorId_observedAt_idx" ON "DeviceObservation"("collectorId", "observedAt");

-- CreateIndex
CREATE INDEX "DeviceObservation_observedAt_idx" ON "DeviceObservation"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Router_deviceId_key" ON "Router"("deviceId");

-- CreateIndex
CREATE INDEX "Router_networkId_idx" ON "Router"("networkId");

-- CreateIndex
CREATE UNIQUE INDEX "RouterInterface_routerId_name_key" ON "RouterInterface"("routerId", "name");

-- CreateIndex
CREATE INDEX "DHCPLease_macAddress_idx" ON "DHCPLease"("macAddress");

-- CreateIndex
CREATE INDEX "DHCPLease_deviceId_idx" ON "DHCPLease"("deviceId");

-- CreateIndex
CREATE INDEX "DHCPLease_address_leaseStart_idx" ON "DHCPLease"("address", "leaseStart");

-- CreateIndex
CREATE INDEX "DeviceMetric_deviceId_metric_timestamp_idx" ON "DeviceMetric"("deviceId", "metric", "timestamp");

-- CreateIndex
CREATE INDEX "DeviceMetric_timestamp_idx" ON "DeviceMetric"("timestamp");

-- CreateIndex
CREATE INDEX "InterfaceMetric_interfaceId_timestamp_idx" ON "InterfaceMetric"("interfaceId", "timestamp");

-- CreateIndex
CREATE INDEX "TrafficFlow_startedAt_idx" ON "TrafficFlow"("startedAt");

-- CreateIndex
CREATE INDEX "TrafficFlow_srcAddress_startedAt_idx" ON "TrafficFlow"("srcAddress", "startedAt");

-- CreateIndex
CREATE INDEX "TrafficFlow_dstAddress_startedAt_idx" ON "TrafficFlow"("dstAddress", "startedAt");

-- CreateIndex
CREATE INDEX "NetworkEvent_occurredAt_idx" ON "NetworkEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "NetworkEvent_type_occurredAt_idx" ON "NetworkEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "NetworkEvent_deviceId_occurredAt_idx" ON "NetworkEvent"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "NetworkEvent_networkId_occurredAt_idx" ON "NetworkEvent"("networkId", "occurredAt");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_idx" ON "AlertRule"("enabled");

-- CreateIndex
CREATE INDEX "Alert_state_severity_idx" ON "Alert"("state", "severity");

-- CreateIndex
CREATE INDEX "Alert_triggeredAt_idx" ON "Alert"("triggeredAt");

-- CreateIndex
CREATE INDEX "Alert_fingerprint_state_idx" ON "Alert"("fingerprint", "state");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_idx" ON "Alert"("resolvedAt");

-- CreateIndex
CREATE INDEX "Notification_type_readAt_createdAt_idx" ON "Notification"("type", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_alertId_idx" ON "Notification"("alertId");

-- CreateIndex
CREATE INDEX "BackupRecord_startedAt_idx" ON "BackupRecord"("startedAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_networkId_createdAt_idx" ON "ScanJob"("networkId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_collectorId_status_idx" ON "ScanJob"("collectorId", "status");

-- CreateIndex
CREATE INDEX "DeviceStatusTransition_deviceId_occurredAt_idx" ON "DeviceStatusTransition"("deviceId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RouterCapability_routerId_capability_key" ON "RouterCapability"("routerId", "capability");

-- CreateIndex
CREATE INDEX "RouterMetric_routerId_timestamp_idx" ON "RouterMetric"("routerId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MonitorTask_dedupeKey_key" ON "MonitorTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "MonitorTask_collectorId_status_idx" ON "MonitorTask"("collectorId", "status");

-- CreateIndex
CREATE INDEX "MonitorTask_status_expiresAt_idx" ON "MonitorTask"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LatencyMeasurement_deviceId_measuredAt_idx" ON "LatencyMeasurement"("deviceId", "measuredAt");

-- CreateIndex
CREATE INDEX "LatencyMeasurement_networkId_measuredAt_idx" ON "LatencyMeasurement"("networkId", "measuredAt");

-- CreateIndex
CREATE INDEX "LatencyMeasurement_measuredAt_idx" ON "LatencyMeasurement"("measuredAt");

-- CreateIndex
CREATE INDEX "LatencyRollup_networkId_bucketStart_idx" ON "LatencyRollup"("networkId", "bucketStart");

-- CreateIndex
CREATE INDEX "LatencyRollup_bucketStart_idx" ON "LatencyRollup"("bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "LatencyRollup_deviceId_bucketStart_key" ON "LatencyRollup"("deviceId", "bucketStart");

-- CreateIndex
CREATE INDEX "NetworkHealthSnapshot_networkId_takenAt_idx" ON "NetworkHealthSnapshot"("networkId", "takenAt");

-- CreateIndex
CREATE INDEX "NetworkHealthSnapshot_takenAt_idx" ON "NetworkHealthSnapshot"("takenAt");

-- CreateIndex
CREATE INDEX "JobFailure_failedAt_idx" ON "JobFailure"("failedAt");

-- CreateIndex
CREATE INDEX "JobFailure_queue_failedAt_idx" ON "JobFailure"("queue", "failedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrafficSource_kind_sourceKey_key" ON "TrafficSource"("kind", "sourceKey");

-- CreateIndex
CREATE INDEX "TrafficSample_measuredAt_idx" ON "TrafficSample"("measuredAt");

-- CreateIndex
CREATE INDEX "TrafficSample_deviceId_measuredAt_idx" ON "TrafficSample"("deviceId", "measuredAt");

-- CreateIndex
CREATE INDEX "TrafficSample_networkId_measuredAt_idx" ON "TrafficSample"("networkId", "measuredAt");

-- CreateIndex
CREATE INDEX "TrafficSample_routerId_measuredAt_idx" ON "TrafficSample"("routerId", "measuredAt");

-- CreateIndex
CREATE INDEX "TrafficSample_interfaceId_measuredAt_idx" ON "TrafficSample"("interfaceId", "measuredAt");

-- CreateIndex
CREATE INDEX "TrafficSample_sourceId_measuredAt_idx" ON "TrafficSample"("sourceId", "measuredAt");

-- CreateIndex
CREATE INDEX "TrafficRollup_bucketStart_idx" ON "TrafficRollup"("bucketStart");

-- CreateIndex
CREATE INDEX "TrafficRollup_deviceId_bucketStart_idx" ON "TrafficRollup"("deviceId", "bucketStart");

-- CreateIndex
CREATE INDEX "TrafficRollup_networkId_bucketStart_idx" ON "TrafficRollup"("networkId", "bucketStart");

-- CreateIndex
CREATE INDEX "TrafficRollup_routerId_bucketStart_idx" ON "TrafficRollup"("routerId", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "TrafficRollup_key_bucketStart_key" ON "TrafficRollup"("key", "bucketStart");

-- AddForeignKey
ALTER TABLE "Network" ADD CONSTRAINT "Network_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collector" ADD CONSTRAINT "Collector_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceIdentifier" ADD CONSTRAINT "DeviceIdentifier_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAddress" ADD CONSTRAINT "DeviceAddress_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAddress" ADD CONSTRAINT "DeviceAddress_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceObservation" ADD CONSTRAINT "DeviceObservation_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceObservation" ADD CONSTRAINT "DeviceObservation_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Router" ADD CONSTRAINT "Router_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Router" ADD CONSTRAINT "Router_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterInterface" ADD CONSTRAINT "RouterInterface_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DHCPLease" ADD CONSTRAINT "DHCPLease_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DHCPLease" ADD CONSTRAINT "DHCPLease_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DHCPLease" ADD CONSTRAINT "DHCPLease_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceMetric" ADD CONSTRAINT "DeviceMetric_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterfaceMetric" ADD CONSTRAINT "InterfaceMetric_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "RouterInterface"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficFlow" ADD CONSTRAINT "TrafficFlow_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficFlow" ADD CONSTRAINT "TrafficFlow_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "RouterInterface"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEvent" ADD CONSTRAINT "NetworkEvent_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkEvent" ADD CONSTRAINT "NetworkEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorNetwork" ADD CONSTRAINT "CollectorNetwork_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorNetwork" ADD CONSTRAINT "CollectorNetwork_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceStatusTransition" ADD CONSTRAINT "DeviceStatusTransition_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterNetwork" ADD CONSTRAINT "RouterNetwork_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterNetwork" ADD CONSTRAINT "RouterNetwork_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterCapability" ADD CONSTRAINT "RouterCapability_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterMetric" ADD CONSTRAINT "RouterMetric_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorTask" ADD CONSTRAINT "MonitorTask_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorTask" ADD CONSTRAINT "MonitorTask_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatencyMeasurement" ADD CONSTRAINT "LatencyMeasurement_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatencyMeasurement" ADD CONSTRAINT "LatencyMeasurement_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatencyMeasurement" ADD CONSTRAINT "LatencyMeasurement_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatencyMeasurement" ADD CONSTRAINT "LatencyMeasurement_monitorTaskId_fkey" FOREIGN KEY ("monitorTaskId") REFERENCES "MonitorTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatencyRollup" ADD CONSTRAINT "LatencyRollup_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkHealthSnapshot" ADD CONSTRAINT "NetworkHealthSnapshot_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSource" ADD CONSTRAINT "TrafficSource_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSource" ADD CONSTRAINT "TrafficSource_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "Collector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSample" ADD CONSTRAINT "TrafficSample_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "TrafficSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSample" ADD CONSTRAINT "TrafficSample_interfaceId_fkey" FOREIGN KEY ("interfaceId") REFERENCES "RouterInterface"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSample" ADD CONSTRAINT "TrafficSample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSample" ADD CONSTRAINT "TrafficSample_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficSample" ADD CONSTRAINT "TrafficSample_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE SET NULL ON UPDATE CASCADE;
