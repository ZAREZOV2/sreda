#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub line: usize,
    pub indent: String,
    pub checked: bool,
    pub text: String,
    pub card_id: Option<String>,
}

pub fn parse(markdown: &str) -> Vec<Item> {
    let mut items = Vec::new();
    let mut fence = false;
    for (index, line) in markdown.split('\n').enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            fence = !fence;
            continue;
        }
        if fence {
            continue;
        }
        let Some(rest) = task_rest(trimmed) else {
            continue;
        };
        let indent_len = line.len() - trimmed.len();
        let indent = line[..indent_len].to_string();
        let (checked, body) = rest;
        let (text, card_id) = split_card(body);
        items.push(Item {
            line: index,
            indent,
            checked,
            text: text.trim().to_string(),
            card_id,
        });
    }
    items
}

fn task_rest(trimmed: &str) -> Option<(bool, &str)> {
    let rest = trimmed.strip_prefix("- ")?;
    let (mark, body) = if let Some(body) = rest.strip_prefix("[ ] ") {
        (false, body)
    } else if let Some(body) = rest.strip_prefix("[x] ").or_else(|| rest.strip_prefix("[X] ")) {
        (true, body)
    } else {
        return None;
    };
    Some((mark, body))
}

fn split_card(body: &str) -> (&str, Option<String>) {
    let marker = "<!-- sreda-card:";
    let Some(start) = body.rfind(marker) else {
        return (body, None);
    };
    let after = &body[start + marker.len()..];
    let Some(end) = after.find("-->") else {
        return (body, None);
    };
    let id = after[..end].trim();
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return (body, None);
    }
    (body[..start].trim_end(), Some(id.to_string()))
}

pub fn render_line(item: &Item) -> String {
    let mark = if item.checked { "x" } else { " " };
    let card = item
        .card_id
        .as_ref()
        .map(|id| format!(" <!-- sreda-card:{id} -->"))
        .unwrap_or_default();
    format!("{}- [{mark}] {}{card}", item.indent, item.text)
}

pub fn replace_line(markdown: &str, item: &Item) -> String {
    markdown
        .split('\n')
        .enumerate()
        .map(|(index, line)| {
            if index == item.line {
                render_line(item)
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn set_checked(markdown: &str, card_id: &str, checked: bool) -> String {
    let mut next = markdown.to_string();
    for mut item in parse(markdown) {
        if item.card_id.as_deref() == Some(card_id) && item.checked != checked {
            item.checked = checked;
            next = replace_line(&next, &item);
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_toggles_linked_items_outside_fences() {
        let source = "# Список\n\n- [ ] Написать\n- [x] Готово <!-- sreda-card:card-1 -->\n```\n- [ ] скрыто\n```\n";
        let items = parse(source);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1].card_id.as_deref(), Some("card-1"));
        let flipped = set_checked(source, "card-1", false);
        assert!(flipped.contains("- [ ] Готово <!-- sreda-card:card-1 -->"));
        assert!(flipped.contains("- [ ] скрыто"));
    }
}
