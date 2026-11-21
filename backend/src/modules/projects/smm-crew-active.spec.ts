import { FindOperator } from 'typeorm';
import { ProjectsService } from './projects.service';

/** Команда SMM-проекта и уволенные (21.11.2026): неактивному работа не
 *  уходит, поэтому экран его не показывает, а показывает того, кто реально
 *  получит карточки, и назначить неактивного нельзя. */

const SAF = '00000000-0000-4000-8000-000000000001';   // дизайнер, уволен
const AZAM = '00000000-0000-4000-8000-000000000002';  // монтажёр + дизайнер
const BEH = '00000000-0000-4000-8000-000000000004';   // видеограф

const opMatch = (val: any, cond: any): boolean =>
  cond instanceof FindOperator
    ? (cond.type === 'in' ? (cond.value as any[]).includes(val) : (() => { throw new Error(cond.type); })())
    : val === cond;
const anyOf = (rows: any[], where: any) => rows.filter(r =>
  (Array.isArray(where) ? where : [where]).some((w: any) => Object.entries(w).every(([k, c]) => opMatch(r[k], c))));

const PEOPLE = [
  { id: SAF, name: 'Сафоев', role: 'designer', secondaryRole: null, isActive: false },
  { id: AZAM, name: 'Азам', role: 'video_editor', secondaryRole: 'designer', isActive: true },
  { id: BEH, name: 'Бехруз', role: 'videographer', secondaryRole: null, isActive: true, isDefaultVideographer: true },
];

function make(smmData: any) {
  const project: any = { id: 'p', name: 'Asan', projectType: 'SMM', smmData, members: [] };
  const svc: any = Object.create(ProjectsService.prototype);
  svc.repo = {
    findOne: jest.fn(async () => project),
    manager: {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (/UPDATE projects/.test(sql)) {
          const set = JSON.parse(params[0]);
          project.smmData = { ...(project.smmData || {}), ...set };
          for (const k of (params[2] || [])) delete project.smmData[k];
        }
        return [];
      }),
    },
  };
  svc.userRepo = {
    find: jest.fn(async ({ where }: any) => anyOf(PEOPLE, where)),
    findOne: jest.fn(async ({ where }: any) => anyOf(PEOPLE, where)[0] ?? null),
  };
  svc.activityLog = { log: jest.fn() };
  svc.gateway = { broadcast: jest.fn() };
  return { svc: svc as ProjectsService, raw: svc, project };
}

describe('команда SMM-проекта — только работающие (21.11.2026)', () => {
  it('уволенный дизайнер в списке не показывается; виден тот, кто получит макеты', async () => {
    const { svc } = make({ designerIds: [SAF] });
    const p: any = await svc.getSmmProfile('p', { id: 'f', role: 'founder' });
    expect(p.designerIds).toEqual([]);
    expect(p.designers).toEqual([]);
    expect(p.crewDefaults.designers).toMatchObject({ id: AZAM });
    expect(p.crewCandidates.designers.map((u: any) => u.id)).toEqual([AZAM]);
  });

  it('работающий из команды — на месте, подсказка «по умолчанию» не нужна', async () => {
    const { svc } = make({ designerIds: [SAF, AZAM], videographerIds: [BEH] });
    const p: any = await svc.getSmmProfile('p', { id: 'f', role: 'founder' });
    expect(p.designerIds).toEqual([AZAM]);
    expect(p.crewDefaults.designers).toBeUndefined();
    expect(p.videographerIds).toEqual([BEH]);
    expect(p.crewDefaults.videographers).toBeUndefined();
  });

  it('назначить уволенного нельзя — сохраняются только работающие', async () => {
    const { raw, project } = make({});
    raw.getSmmProfile = jest.fn(async () => ({}));
    await raw.setSmmProfile('p', { designerIds: [SAF, AZAM] }, { id: 'f', role: 'founder' });
    expect(project.smmData.designerIds).toEqual([AZAM]);
  });
});
