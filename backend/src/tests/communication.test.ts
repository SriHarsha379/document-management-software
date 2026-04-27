/**
 * Unit tests for the communication module.
 * Run with: npm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidEmail, isValidPhone } from '../modules/communication/recipientResolver.js';
import {
  renderTemplate,
  DEFAULT_BODY_TEMPLATE,
  DEFAULT_SUBJECT_TEMPLATE,
  TemplateValidationError,
} from '../modules/communication/templateService.js';
import { PERMISSIONS, ROLE_PERMISSION_MATRIX, ROLES } from '../modules/rbac/permissions.js';
import { CommunicationValidationError } from '../modules/communication/communicationService.js';

// ── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
  });
  it('accepts email with subdomain', () => {
    expect(isValidEmail('user@mail.example.co.in')).toBe(true);
  });
  it('rejects missing @', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });
  it('rejects missing domain dot', () => {
    expect(isValidEmail('user@localhost')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
  it('rejects address with spaces', () => {
    expect(isValidEmail('user @example.com')).toBe(false);
  });
  it('rejects multiple @ signs', () => {
    expect(isValidEmail('a@b@c.com')).toBe(false);
  });
});

// ── isValidPhone ──────────────────────────────────────────────────────────────

describe('isValidPhone', () => {
  it('accepts E.164 with +', () => {
    expect(isValidPhone('+919876543210')).toBe(true);
  });
  it('accepts digits only (7+)', () => {
    expect(isValidPhone('9876543')).toBe(true);
  });
  it('rejects too short', () => {
    expect(isValidPhone('+1234')).toBe(false);
  });
  it('rejects letters', () => {
    expect(isValidPhone('+91abc')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(isValidPhone('')).toBe(false);
  });
  it('rejects spaces', () => {
    expect(isValidPhone('+91 98765 43210')).toBe(false);
  });
});

// ── renderTemplate ────────────────────────────────────────────────────────────

describe('renderTemplate', () => {
  it('renders basic Handlebars substitution', () => {
    const out = renderTemplate('Hello {{name}}!', { name: 'World' });
    expect(out).toBe('Hello World!');
  });

  it('renders default body template', () => {
    const out = renderTemplate(DEFAULT_BODY_TEMPLATE, {
      recipientName:  'ABC Traders',
      documentCount:  3,
      vehicleNo:      'MH12AB1234',
      date:           '2026-04-26',
      companyName:    'Acme Logistics',
    });
    expect(out).toContain('ABC Traders');
    expect(out).toContain('3 document(s)');
    expect(out).toContain('MH12AB1234');
    expect(out).toContain('Acme Logistics');
  });

  it('renders default subject template', () => {
    const out = renderTemplate(DEFAULT_SUBJECT_TEMPLATE, {
      vehicleNo: 'MH12AB1234',
      date:      '2026-04-26',
    });
    expect(out).toBe('Documents for Vehicle MH12AB1234 – 2026-04-26');
  });

  it('leaves missing vars as empty string', () => {
    const out = renderTemplate('Hello {{missing}}!', {});
    expect(out).toBe('Hello !');
  });
});

// ── TemplateValidationError ───────────────────────────────────────────────────

describe('TemplateValidationError', () => {
  it('is an instance of Error', () => {
    const err = new TemplateValidationError('bad code');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('bad code');
    expect(err.name).toBe('TemplateValidationError');
  });
});

// ── CommunicationValidationError ──────────────────────────────────────────────

describe('CommunicationValidationError', () => {
  it('is an instance of Error', () => {
    const err = new CommunicationValidationError('no recipients');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CommunicationValidationError');
  });
});

// ── Permission matrix: communication permissions ──────────────────────────────

describe('communication permissions in ROLE_PERMISSION_MATRIX', () => {
  it('L1 has COMMUNICATION_READ but not COMMUNICATION_SEND', () => {
    const l1 = ROLE_PERMISSION_MATRIX[ROLES.L1];
    expect(l1).toContain(PERMISSIONS.COMMUNICATION_READ);
    expect(l1).not.toContain(PERMISSIONS.COMMUNICATION_SEND);
  });

  it('L2 has COMMUNICATION_READ but not COMMUNICATION_SEND', () => {
    const l2 = ROLE_PERMISSION_MATRIX[ROLES.L2];
    expect(l2).toContain(PERMISSIONS.COMMUNICATION_READ);
    expect(l2).not.toContain(PERMISSIONS.COMMUNICATION_SEND);
  });

  it('L3 has COMMUNICATION_SEND and COMMUNICATION_READ but not TEMPLATE_MANAGE', () => {
    const l3 = ROLE_PERMISSION_MATRIX[ROLES.L3];
    expect(l3).toContain(PERMISSIONS.COMMUNICATION_SEND);
    expect(l3).toContain(PERMISSIONS.COMMUNICATION_READ);
    expect(l3).not.toContain(PERMISSIONS.COMMUNICATION_TEMPLATE_MANAGE);
  });

  it('ADMIN has all three communication permissions', () => {
    const admin = ROLE_PERMISSION_MATRIX[ROLES.ADMIN];
    expect(admin).toContain(PERMISSIONS.COMMUNICATION_SEND);
    expect(admin).toContain(PERMISSIONS.COMMUNICATION_READ);
    expect(admin).toContain(PERMISSIONS.COMMUNICATION_TEMPLATE_MANAGE);
  });

  it('SUPER_ADMIN has all three communication permissions', () => {
    const sa = ROLE_PERMISSION_MATRIX[ROLES.SUPER_ADMIN];
    expect(sa).toContain(PERMISSIONS.COMMUNICATION_SEND);
    expect(sa).toContain(PERMISSIONS.COMMUNICATION_READ);
    expect(sa).toContain(PERMISSIONS.COMMUNICATION_TEMPLATE_MANAGE);
  });
});
