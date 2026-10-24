//! drive [--edit] [--no-compare] FILE...: one line per file, with timings and anything lost.
use std::panic;
use std::time::Instant;

fn main() {
    let mut edit = false;
    let mut compare = true;
    let mut files = Vec::new();
    for a in std::env::args().skip(1) {
        match a.as_str() {
            "--edit" => edit = true,
            "--no-compare" => compare = false,
            _ => files.push(a),
        }
    }
    for f in files {
        let bytes = match std::fs::read(&f) {
            Ok(b) => b,
            Err(e) => {
                println!("{f}\tREADERR\t{e}");
                continue;
            }
        };
        let name = f.rsplit('/').next().unwrap().to_string();
        let t = Instant::now();
        let res = panic::catch_unwind(|| office_stress::run(&bytes, &name, edit, compare));
        let ms = t.elapsed().as_millis();
        match res {
            Ok(Ok(r)) => println!(
                "{f}\tOK\t{}\tpages={}\topen={} layout={} paint={} save={} total={ms}ms\t{}",
                r.kind,
                r.pages,
                r.open_ms,
                r.layout_ms,
                r.paint_ms,
                r.save_ms,
                r.issues.join(" | ")
            ),
            Ok(Err(e)) => println!("{f}\tERR\t{e}"),
            Err(p) => {
                let msg = p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                println!("{f}\tPANIC\t{msg}");
            }
        }
    }
}
