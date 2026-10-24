//! drive [--edit] [--no-compare] [--stack KB] FILE...: one line per file, with timings and
//! anything lost. `--stack` runs each file on a thread with that much stack: WebAssembly's is
//! 1 MB (1024), far less than a native main thread's 8 MB.
use std::panic;
use std::time::Instant;

fn main() {
    let mut edit = false;
    let mut compare = true;
    let mut stack = None;
    let mut files = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--edit" => edit = true,
            "--no-compare" => compare = false,
            "--stack" => stack = args.next().and_then(|k| k.parse::<usize>().ok()),
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
        let res = match stack {
            Some(kb) => {
                let (bytes, name) = (bytes.clone(), name.clone());
                std::thread::Builder::new()
                    .stack_size(kb * 1024)
                    .spawn(move || panic::catch_unwind(|| office_stress::run(&bytes, &name, edit, compare)))
                    .unwrap()
                    .join()
                    .unwrap()
            }
            None => panic::catch_unwind(|| office_stress::run(&bytes, &name, edit, compare)),
        };
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
                let msg =
                    p.downcast_ref::<String>().cloned().or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
                println!("{f}\tPANIC\t{msg}");
            }
        }
    }
}
