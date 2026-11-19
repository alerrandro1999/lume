import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dateKey, formatDay, monthDays, parseDay } from './planner-dates';
import type { PlannerTask } from './planner-types';

export function PlannerCalendar({ month, selected, today, tasks, changeMonth, select }: {
  month: string; selected: string; today: string; tasks: PlannerTask[];
  changeMonth(month: string): void; select(day: string): void;
}) {
  const date = parseDay(month);
  const monthName = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const byDay = new Map<string, PlannerTask[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const group = byDay.get(task.dueDate) ?? [];
    group.push(task);
    byDay.set(task.dueDate, group);
  }
  function move(amount: number) {
    const next = parseDay(month.slice(0, 7) + '-01');
    next.setMonth(next.getMonth() + amount);
    const day = dateKey(next);
    changeMonth(day);
    select(day);
  }
  return <section className="planner-calendar" aria-label="Calendário de atividades">
    <div className="planner-month-heading">
      <h2>{monthName}</h2>
      <div>
        <button className="icon-button" type="button" aria-label="Mês anterior" onClick={() => move(-1)}><ChevronLeft size={17} /></button>
        <button className="planner-button" type="button" onClick={() => { changeMonth(today); select(today); }}>Hoje</button>
        <button className="icon-button" type="button" aria-label="Próximo mês" onClick={() => move(1)}><ChevronRight size={17} /></button>
      </div>
    </div>
    <div className="planner-weekdays" aria-hidden="true">{['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(label => <span key={label}>{label}</span>)}</div>
    <div className="planner-days">
      {monthDays(month).map(day => {
        const entries = byDay.get(day) ?? [];
        return <button
          className={`planner-day${day.slice(0, 7) !== month.slice(0, 7) ? ' planner-day-outside' : ''}`}
          key={day}
          type="button"
          aria-label={`${parseDay(day).toLocaleDateString('pt-BR')}, ${entries.length} ${entries.length === 1 ? 'atividade' : 'atividades'}`}
          aria-pressed={day === selected}
          aria-current={day === today ? 'date' : undefined}
          onClick={() => select(day)}
        >
          <span className="planner-day-number">{parseDay(day).getDate()}</span>
          {entries.slice(0, 2).map(task => <span key={task.id} className={task.status === 'done' ? 'planner-day-title planner-day-done' : 'planner-day-title'}>{task.title}</span>)}
          {entries.length > 2 && <small>+{entries.length - 2}</small>}
        </button>;
      })}
    </div>
    <p className="planner-calendar-help">Atividades de {formatDay(selected)}</p>
  </section>;
}
