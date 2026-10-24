//! save-app INPUT OUTPUT: unchanged save through the native view, including the app's clock
//! initialization. This catches changes the lower-level officec path cannot exercise.
use office_sheets::view::SheetsView;
use office_slides::view::SlidesView;
use office_word::view::WordView;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 || args[0] == args[1] {
        return Err("usage: save-app INPUT OUTPUT (distinct paths)".into());
    }
    let bytes = std::fs::read(&args[0])?;
    let ext = args[0].rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let saved = match ext.as_str() {
        "docx" | "docm" | "dotx" => WordView::open(&bytes)?.save()?,
        "pptx" | "pptm" | "potx" => SlidesView::open(&bytes)?.save()?,
        _ => {
            let mut view = SheetsView::open(&bytes, &args[0])?;
            view.set_now(46000.5);
            view.save()?
        }
    };
    std::fs::write(&args[1], saved)?;
    Ok(())
}
