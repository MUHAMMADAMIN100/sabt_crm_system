/**
 * Короткие метки вместо UUID: T3 — задача, E2 — сотрудник, P5 — проект.
 *
 * ИИ путает длинные идентификаторы и может их выдумать. С метками он
 * выбирает из того, что ему показали, а мы переводим метку обратно в id —
 * и всё, чего не показывали, отбрасываем.
 */
/** T задача, E сотрудник (userId), P проект, C клиент/лид, I карточка контент-плана, F клиент в финансах, S сотрудник в зарплатной ведомости. */
export type RefKind = 'T' | 'E' | 'P' | 'C' | 'I' | 'F' | 'S';

export interface RefEntry { kind: RefKind; id: string; label: string }

export class RefTable {
  private byRef = new Map<string, RefEntry>();
  private byId = new Map<string, string>();
  private counters: Record<RefKind, number> = { T: 0, E: 0, P: 0, C: 0, I: 0, F: 0, S: 0 };

  add(kind: RefKind, id: string, label: string): string {
    const key = `${kind}:${id}`;
    const existing = this.byId.get(key);
    if (existing) return existing;
    const ref = `${kind}${++this.counters[kind]}`;
    this.byRef.set(ref, { kind, id, label });
    this.byId.set(key, ref);
    return ref;
  }

  /** id по метке. Принимает и сам UUID, если он уже встречался. */
  resolve(kind: RefKind, refOrId: unknown): RefEntry | null {
    const s = String(refOrId ?? '').trim().toUpperCase();
    const direct = this.byRef.get(s);
    if (direct && direct.kind === kind) return direct;
    const byUuid = this.byId.get(`${kind}:${String(refOrId ?? '').trim()}`);
    return byUuid ? this.byRef.get(byUuid) || null : null;
  }

  label(kind: RefKind, id: string): string | null {
    const ref = this.byId.get(`${kind}:${id}`);
    return ref ? this.byRef.get(ref)?.label ?? null : null;
  }

  /** Снимок для отложенных действий (подтверждение, выбор). */
  toJSON(): { entries: [string, RefEntry][]; counters: Record<RefKind, number> } {
    return { entries: [...this.byRef.entries()], counters: { ...this.counters } };
  }

  static fromJSON(data: { entries: [string, RefEntry][]; counters: Record<RefKind, number> }): RefTable {
    const t = new RefTable();
    for (const [ref, e] of data.entries) {
      t.byRef.set(ref, e);
      t.byId.set(`${e.kind}:${e.id}`, ref);
    }
    t.counters = { T: 0, E: 0, P: 0, C: 0, I: 0, F: 0, S: 0, ...data.counters };
    return t;
  }
}
