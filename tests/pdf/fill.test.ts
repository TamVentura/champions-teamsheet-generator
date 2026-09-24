// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { fillTeamsheet } from '../../src/pdf/fill';
import type { ChampionsMon, PlayerProfile } from '../../src/domain/types';

const template = new Uint8Array(readFileSync(join(__dirname, '../../src/pdf/team-list-form.pdf')));

const profile: PlayerProfile = {
  playerName: 'Test Player',
  trainerNameInGame: 'Trainer',
  switchProfileName: 'Switchy',
  playerId: '1234567',
  supportId: 'SUP-42',
  dateOfBirth: '27/02/2001',
  division: 'Master',
};
const mon: ChampionsMon = {
  species: 'Basculegion',
  gender: 'M',
  ability: 'Adaptability',
  item: 'Choice Scarf',
  nature: 'Jolly',
  evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
  moves: ['Last Respects', 'Wave Crash', 'Flip Turn', 'Aqua Jet'],
};

describe('fillTeamsheet', () => {
  it('template exposes the Support ID, DOB parts and per-slot stat fields', async () => {
    const names = (await PDFDocument.load(template)).getForm().getFields().map((f) => f.getName());
    for (const n of ['support_id', 'player_id', 'dob_1', 'dob_2', 'dob_3', 'div_master', 'p6_move4', 'p6_spe'])
      expect(names).toContain(n);
  });

  it('fills and flattens both official pages', async () => {
    const out = await PDFDocument.load(await fillTeamsheet(template, profile, 'Team', [mon, { ...mon, species: 'Aegislash', moves: ['King’s Shield', 'Shadow Ball', '', ''] }]));
    expect(out.getPageCount()).toBe(2);
    expect(out.getForm().getFields()).toHaveLength(0); // flattened into the page
  });

  it('can emit just the staff or just the opponents page', async () => {
    for (const pages of ['staff', 'open'] as const) {
      const out = await PDFDocument.load(await fillTeamsheet(template, profile, 'Team', [mon], pages));
      expect(out.getPageCount()).toBe(1);
    }
  });
});
