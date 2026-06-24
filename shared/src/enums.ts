export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  PRODUCT_MANAGER = 'PRODUCT_MANAGER',
  ENGINEER = 'ENGINEER',
  CLIENT = 'CLIENT',
  TESTING = 'TESTING',
}

export enum ProjectCategory {
  FLAGSHIP = 'FLAGSHIP',
  PLATFORM = 'PLATFORM',
  B2C_SMB = 'B2C_SMB',
  PASSION = 'PASSION',
  CONSULTING = 'CONSULTING',
  SOCIAL_IMPACT = 'SOCIAL_IMPACT',
}

export enum ProjectPhase {
  IDEA = 'IDEA',
  ARCHITECTURE = 'ARCHITECTURE',
  DEVELOPMENT = 'DEVELOPMENT',
  TESTING = 'TESTING',
  LIVE = 'LIVE',
  MAINTENANCE = 'MAINTENANCE',
}

export enum HealthStatus {
  GREEN = 'GREEN',
  YELLOW = 'YELLOW',
  RED = 'RED',
}

export enum TaskStatus {
  BACKLOG = 'BACKLOG',
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
}

export enum TaskPriority {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
  P3 = 'P3',
}

export enum MilestoneStatus {
  UPCOMING = 'UPCOMING',
  COMPLETED = 'COMPLETED',
  MISSED = 'MISSED',
}

export enum DecisionStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  SUPERSEDED = 'SUPERSEDED',
}

// ─── Pulse module (2026-05-28) ───
// Mirror of the Prisma enums so both backend handlers and the frontend
// admin Pulse page can reference the same string set without importing
// from @prisma/client (which leaks the full DB type).

export enum DevicePlatform {
  WINDOWS = 'WINDOWS',
  MACOS = 'MACOS',
  LINUX = 'LINUX',
}

export enum DeviceEnrollmentStatus {
  PENDING_ENROLLMENT = 'PENDING_ENROLLMENT',
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  INACTIVE = 'INACTIVE',
}

export enum DevicePowerState {
  ON = 'ON',
  IDLE = 'IDLE',
  LOCKED = 'LOCKED',
  OFF = 'OFF',
}

export enum DeviceRiskLevel {
  HEALTHY = 'HEALTHY',
  AT_RISK = 'AT_RISK',
  CRITICAL = 'CRITICAL',
}

export enum DeviceAlertType {
  AGENT_OFFLINE = 'AGENT_OFFLINE',
  MISSING_CRITICAL_PATCHES = 'MISSING_CRITICAL_PATCHES',
  REBOOT_REQUIRED_OVERDUE = 'REBOOT_REQUIRED_OVERDUE',
  ANTIVIRUS_DISABLED = 'ANTIVIRUS_DISABLED',
  FIREWALL_DISABLED = 'FIREWALL_DISABLED',
  BITLOCKER_DISABLED = 'BITLOCKER_DISABLED',
  UNSUPPORTED_OS = 'UNSUPPORTED_OS',
  RISKY_SOFTWARE_INSTALLED = 'RISKY_SOFTWARE_INSTALLED',
  HIGH_RISK_SCORE = 'HIGH_RISK_SCORE',
}

export enum DeviceAlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
}
