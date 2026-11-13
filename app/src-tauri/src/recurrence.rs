use crate::storage::{Board, ColumnKind, Task};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recurrence {
    pub freq: String,
    pub interval: u32,
}

pub fn valid(recurrence: &Recurrence) -> bool {
    matches!(recurrence.freq.as_str(), "daily" | "weekly" | "monthly")
        && (1..=52).contains(&recurrence.interval)
}

pub fn next_occurrence(from_ms: i64, recurrence: &Recurrence) -> i64 {
    let step = i64::from(recurrence.interval);
    match recurrence.freq.as_str() {
        "daily" => from_ms.saturating_add(step.saturating_mul(86_400_000)),
        "weekly" => from_ms.saturating_add(step.saturating_mul(7 * 86_400_000)),
        "monthly" => from_ms.saturating_add(step.saturating_mul(30 * 86_400_000)),
        _ => from_ms,
    }
}

/// Завершённая повторяющаяся карточка остаётся в «Готово» без правила,
/// а следующая копия появляется в первой колонке «Нужно сделать».
pub fn spawn_if_completed(board: &mut Board, task_id: &str, entered_done: bool) {
    if !entered_done {
        return;
    }
    let Some(task) = board
        .columns
        .iter_mut()
        .flat_map(|column| column.tasks.iter_mut())
        .find(|task| task.id == task_id)
    else {
        return;
    };
    let Some(recurrence) = task.recurrence.clone() else {
        return;
    };
    if !valid(&recurrence) {
        return;
    }
    let mut next = task.clone();
    next.id = format!("task-{}", uuid::Uuid::new_v4().simple());
    next.time_spent_ms = 0;
    next.reminder_at = Some(next_occurrence(
        task.reminder_at.unwrap_or_else(now_ms),
        &recurrence,
    ));
    task.recurrence = None;
    let index = board
        .columns
        .iter()
        .position(|column| column.kind == Some(ColumnKind::Todo))
        .unwrap_or(0);
    if let Some(column) = board.columns.get_mut(index) {
        column.tasks.insert(0, next);
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn blank_task(id: &str, title: &str) -> Task {
    Task {
        id: id.into(),
        title: title.into(),
        description: String::new(),
        label: String::new(),
        color: "gray".into(),
        priority: "medium".into(),
        time_spent_ms: 0,
        recurrence: None,
        reminder_at: None,
        linked_doc_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Column;

    #[test]
    fn weekly_completion_spawns_one_successor() {
        let mut board = Board {
            id: "b".into(),
            name: "Доска".into(),
            description: String::new(),
            columns: vec![
                Column {
                    id: "todo".into(),
                    name: "Нужно сделать".into(),
                    kind: Some(ColumnKind::Todo),
                    tasks: vec![],
                },
                Column {
                    id: "done".into(),
                    name: "Готово".into(),
                    kind: Some(ColumnKind::Done),
                    tasks: vec![Task {
                        recurrence: Some(Recurrence {
                            freq: "weekly".into(),
                            interval: 2,
                        }),
                        reminder_at: Some(1_000),
                        ..blank_task("t1", "Стендап")
                    }],
                },
            ],
        };
        spawn_if_completed(&mut board, "t1", true);
        assert!(board.columns[1].tasks[0].recurrence.is_none());
        assert_eq!(board.columns[0].tasks.len(), 1);
        assert_eq!(board.columns[0].tasks[0].title, "Стендап");
        assert_eq!(
            board.columns[0].tasks[0].reminder_at,
            Some(1_000 + 2 * 7 * 86_400_000)
        );
        spawn_if_completed(&mut board, "t1", true);
        assert_eq!(board.columns[0].tasks.len(), 1);
    }
}
