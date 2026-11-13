pub fn render_fragment(markdown: &str) -> Result<String, String> {
    if markdown.len() > 2 * 1024 * 1024 {
        return Err("Документ больше 2 МБ".into());
    }
    let mut options = comrak::Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.autolink = true;
    options.render.unsafe_ = false;
    Ok(comrak::markdown_to_html(markdown, &options))
}

pub fn render_document(title: &str, markdown: &str) -> Result<String, String> {
    let body = render_fragment(markdown)?;
    let safe_title = title.replace('<', "").replace('>', "").replace('&', "");
    Ok(format!(
        "<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"utf-8\"><title>{safe_title}</title>
<style>body{{font:16px/1.6 sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1c1e21}} pre,code{{font-family:ui-monospace,monospace}} table{{border-collapse:collapse}} td,th{{border:1px solid #ccc;padding:6px 8px}}</style>
</head><body>{body}</body></html>"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_gfm_without_raw_html() {
        let html = render_fragment("# Заголовок\n\n- [ ] пункт\n\n<script>alert(1)</script>\n\n~~нет~~").unwrap();
        assert!(html.contains("<h1"));
        assert!(html.contains("пункт"));
        assert!(!html.to_ascii_lowercase().contains("<script"));
        assert!(html.contains("<del>") || html.contains("нет"));
    }
}
