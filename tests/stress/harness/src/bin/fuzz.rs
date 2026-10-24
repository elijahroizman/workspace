//! fuzz SEEDS_DIR OUT_DIR THREADS SECONDS: mutates the seed files' XML parts (and sometimes the
//! zip itself) and runs each result through `office_stress::run`. Panics are saved to
//! OUT_DIR/crash-*, inputs that take longer than 20 s to OUT_DIR/hang-* (then the process exits,
//! for the calling loop to restart). The input being run is kept in OUT_DIR/cur-THREAD.EXT, so an
//! abort (out of memory, stack overflow) leaves it behind.
use std::collections::HashSet;
use std::io::{Cursor, Read, Write};
use std::panic;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        if n == 0 { 0 } else { (self.next() % n as u64) as usize }
    }
}

const TOKENS: &[&str] = &[
    "-1", "0", "99999999999", "-99999999999", "2147483648", "4294967296", "1e308", "NaN", "inf", "-0", "1.5",
    "18446744073709551616", "XFD1048576", "XFE1", "A0", "A1048577", "ZZZZZZ99999999", "1:1048576", "A:XFD",
    "&amp;", "&#0;", "&#xFFFF;", "&#x10FFFF;", "&lt;", "\u{202E}", "\u{FEFF}", "\u{0}", "\"", "'", "<", ">", "</w:p>", "<w:p>",
    "<w:r><w:t>x</w:t></w:r>", "<a:t>x</a:t>", "<c r=\"A1\"><v>1</v></c>", "<w:tbl/>", "<w:tc/>", "<w:tr/>", "w:val=\"999999999\"",
    "=A1", "=SUM(A:A)", "=A1:XFD1048576", "=INDIRECT(\"A1\")", "#REF!", "rId1", "rId999", "../../../x.xml", "/", "",
];

fn mutate_text(r: &mut Rng, data: &mut Vec<u8>) {
    if data.is_empty() {
        return;
    }
    let n = data.len();
    match r.below(9) {
        0 => {
            let i = r.below(n);
            data[i] ^= 1 << r.below(8);
        }
        1 => {
            let a = r.below(n);
            let b = (a + 1 + r.below(64)).min(n);
            data.drain(a..b);
        }
        2 => {
            let a = r.below(n);
            let b = (a + 1 + r.below(256)).min(n);
            let chunk = data[a..b].to_vec();
            let at = r.below(n);
            let big = r.below(10) == 0;
            let times = 1 + r.below(if big { 200 } else { 3 });
            for _ in 0..times {
                data.splice(at..at, chunk.iter().copied());
            }
        }
        3 | 4 | 5 => {
            // Replace the value of an attribute or a text node with an interesting token.
            let quotes: Vec<usize> = data.iter().enumerate().filter(|(_, &c)| c == b'"').map(|(i, _)| i).collect();
            if quotes.len() >= 2 {
                let q = r.below(quotes.len() / 2) * 2;
                let (a, b) = (quotes[q] + 1, quotes[q + 1]);
                let t = TOKENS[r.below(TOKENS.len())].as_bytes();
                data.splice(a..b, t.iter().copied());
            }
        }
        6 => {
            let at = r.below(n);
            let t = TOKENS[r.below(TOKENS.len())].as_bytes();
            data.splice(at..at, t.iter().copied());
        }
        7 => {
            // Swap two elements' worth of text.
            let a = r.below(n);
            let b = r.below(n);
            let (a, b) = (a.min(b), a.max(b));
            let len = r.below(128).min(b - a).min(n - b);
            for i in 0..len {
                data.swap(a + i, b + i);
            }
        }
        _ => {
            // Truncate.
            data.truncate(r.below(n));
        }
    }
}

fn unzip(bytes: &[u8]) -> Option<Vec<(String, Vec<u8>)>> {
    let mut z = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let mut out = Vec::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i).ok()?;
        let mut v = Vec::new();
        f.read_to_end(&mut v).ok()?;
        out.push((f.name().to_string(), v));
    }
    Some(out)
}

fn rezip(parts: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (n, d) in parts {
        if w.start_file(n.as_str(), o).is_ok() {
            let _ = w.write_all(d);
        }
    }
    w.finish().map(|c| c.into_inner()).unwrap_or_default()
}

fn mutate(r: &mut Rng, seed: &[u8], parts: Option<&Vec<(String, Vec<u8>)>>) -> Vec<u8> {
    let Some(parts) = parts else {
        let mut d = seed.to_vec();
        for _ in 0..1 + r.below(4) {
            mutate_text(r, &mut d);
        }
        return d;
    };
    let mut parts = parts.clone();
    let rounds = 1 + r.below(4);
    for _ in 0..rounds {
        let xml: Vec<usize> = parts.iter().enumerate().filter(|(_, (n, _))| n.ends_with(".xml") || n.ends_with(".rels")).map(|(i, _)| i).collect();
        match r.below(20) {
            0 if !parts.is_empty() => {
                let i = r.below(parts.len());
                parts.remove(i);
            }
            1 if !parts.is_empty() => {
                let i = r.below(parts.len());
                let j = r.below(parts.len());
                let d = parts[j].1.clone();
                parts[i].1 = d;
            }
            2 if !parts.is_empty() => {
                let i = r.below(parts.len());
                parts[i].0 = parts[i].0.to_ascii_uppercase();
            }
            _ if !xml.is_empty() => {
                // Favour the main parts.
                let main: Vec<usize> = xml
                    .iter()
                    .copied()
                    .filter(|&i| {
                        let n = &parts[i].0;
                        n.contains("document") || n.contains("slide") || n.contains("sheet") || n.contains("workbook") || n.contains("styles")
                    })
                    .collect();
                let i = if !main.is_empty() && r.below(3) > 0 { main[r.below(main.len())] } else { xml[r.below(xml.len())] };
                mutate_text(r, &mut parts[i].1);
            }
            _ => {}
        }
    }
    let mut z = rezip(&parts);
    if r.below(30) == 0 {
        mutate_text(r, &mut z);
    }
    z
}

thread_local! {
    static WHERE: std::cell::RefCell<String> = Default::default();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (seeds_dir, out, threads, secs) = (&args[1], args[2].clone(), args[3].parse::<usize>().unwrap(), args[4].parse::<u64>().unwrap());
    std::fs::create_dir_all(&out).unwrap();
    let mut seeds = Vec::new();
    for e in std::fs::read_dir(seeds_dir).unwrap().flatten() {
        let p = e.path();
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        if let Ok(b) = std::fs::read(&p) {
            if b.len() < 3_000_000 {
                let parts = unzip(&b);
                seeds.push((name, b, parts));
            }
        }
    }
    eprintln!("{} seeds", seeds.len());
    let seeds = Arc::new(seeds);
    panic::set_hook(Box::new(|info| {
        let loc = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let msg = info.payload().downcast_ref::<String>().cloned().or_else(|| info.payload().downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
        WHERE.with(|w| *w.borrow_mut() = format!("{loc} {msg}"));
    }));
    let seen = Arc::new(Mutex::new(HashSet::<String>::new()));
    let starts: Arc<Vec<AtomicU64>> = Arc::new((0..threads).map(|_| AtomicU64::new(0)).collect());
    let count = Arc::new(AtomicU64::new(0));
    let begin = Instant::now();
    let now_ms = || SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as u64;
    {
        let (starts, out) = (starts.clone(), out.clone());
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            for (t, s) in starts.iter().enumerate() {
                let s = s.load(Ordering::SeqCst);
                if s != 0 && now_ms() - s > 20_000 {
                    for e in std::fs::read_dir(&out).into_iter().flatten().flatten() {
                        let n = e.file_name().to_string_lossy().to_string();
                        if let Some(ext) = n.strip_prefix(&format!("cur-{t}.")) {
                            let _ = std::fs::copy(e.path(), format!("{out}/hang-{}-{t}.{ext}", now_ms()));
                        }
                    }
                    eprintln!("hang in thread {t}");
                    std::process::exit(3);
                }
            }
        });
    }
    let mut handles = Vec::new();
    for t in 0..threads {
        let (seeds, seen, starts, count, out) = (seeds.clone(), seen.clone(), starts.clone(), count.clone(), out.clone());
        handles.push(std::thread::spawn(move || {
            let mut r = Rng(now_ms() ^ ((t as u64 + 1) * 0x9E3779B97F4A7C15));
            while begin.elapsed().as_secs() < secs {
                let (name, bytes, parts) = &seeds[r.below(seeds.len())];
                let input = mutate(&mut r, bytes, parts.as_ref());
                // Named for the seed's extension, which picks the view.
                let ext = name.rsplit('.').next().unwrap_or("bin");
                let cur = format!("{out}/cur-{t}.{ext}");
                for old in ["docx", "pptx", "xlsx", "xlsm", "csv", "docm", "dotx", "pptm", "potx", "bin"] {
                    if old != ext {
                        let _ = std::fs::remove_file(format!("{out}/cur-{t}.{old}"));
                    }
                }
                std::fs::write(&cur, &input).unwrap();
                let fname = format!("{t}-{name}");
                starts[t].store(now_ms(), Ordering::SeqCst);
                let edit = r.below(3) == 0;
                let res = panic::catch_unwind(|| office_stress::run(&input, &fname, edit, false));
                starts[t].store(0, Ordering::SeqCst);
                count.fetch_add(1, Ordering::Relaxed);
                if res.is_err() {
                    let w = WHERE.with(|w| w.borrow().clone());
                    let key = w.split(' ').next().unwrap_or("").to_string();
                    let fresh = seen.lock().unwrap().insert(key.clone());
                    if fresh {
                        let ext = name.rsplit('.').next().unwrap_or("bin");
                        let path = format!("{out}/crash-{}-{t}.{ext}", seen.lock().unwrap().len());
                        std::fs::write(&path, &input).unwrap();
                        eprintln!("CRASH {path}: {w}");
                    }
                }
            }
        }));
    }
    for h in handles {
        let _ = h.join();
    }
    eprintln!("{} runs in {}s", count.load(Ordering::Relaxed), begin.elapsed().as_secs());
}
