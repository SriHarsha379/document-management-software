import { ACCOUNTANT_ROLE } from '../services/api';

export function getOfficerRoleLabel(role: string | null): string {
  return role?.trim() || ACCOUNTANT_ROLE;
}

export function formatOfficerLabel(name: string, role: string | null): string {
  return `${name} (${getOfficerRoleLabel(role)})`;
}
