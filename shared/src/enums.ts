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
