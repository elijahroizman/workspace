use office_core::{
    opc::{content_types::types, rels::kind, Package},
    xml::ns,
};

#[test]
fn clone_should_share_cached_part_data() {
    let mut pkg = Package::new();
    pkg.put("big.bin", vec![42; 1_000_000], "application/octet-stream");
    let pkg = Package::read(&pkg.to_bytes().unwrap()).unwrap();
    let first = pkg.part("big.bin").unwrap();
    let copy = pkg.clone();
    let second = copy.part("big.bin").unwrap();
    assert_eq!(first.as_ptr(), second.as_ptr(), "package clone copies all cached decompressed bytes");
}

#[test]
fn encoded_relationship_target_matches_zip_part() {
    let mut pkg = Package::new();
    pkg.put("word/media/my%20picture.png", vec![1], "image/png");
    let rel = office_core::opc::Relationship {
        id: "rId1".into(),
        rel_type: kind::uri(kind::IMAGE),
        target: "media/my%20picture.png".into(),
        external: false,
    };
    let target = pkg.target("word/document.xml", &rel).unwrap();
    assert!(pkg.has(&target), "resolved target {target:?} does not match actual zip part");
}

#[test]
fn property_date_qname_stays_bound_with_nonstandard_prefix() {
    let mut pkg = Package::new();
    let source = format!(r#"<cp:coreProperties xmlns:cp="{}" xmlns:dt="{}" xmlns:xsi="{}"/>"#, ns::CP, ns::DCTERMS, ns::XSI);
    pkg.put("docProps/core.xml", source.as_bytes().to_vec(), types::CORE_PROPERTIES);
    pkg.relate("", kind::CORE_PROPERTIES, "docProps/core.xml").unwrap();
    let props = office_core::opc::Properties { created: Some("2026-10-22T00:00:00Z".into()), ..Default::default() };
    props.write(&mut pkg).unwrap();
    let out = String::from_utf8(pkg.part("docProps/core.xml").unwrap().to_vec()).unwrap();
    assert!(!out.contains("dcterms:W3CDTF") || out.contains("xmlns:dcterms="));
}

#[test]
fn package_loading_and_lookup_scale_linearly() {
    use std::{
        io::Cursor,
        time::{Duration, Instant},
    };
    use zip::{write::SimpleFileOptions, ZipWriter};
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    zip.start_file("[Content_Types].xml", options).unwrap();
    std::io::Write::write_all(&mut zip, br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#).unwrap();
    for i in 0..20000 {
        zip.start_file(format!("parts/{i}.xml"), options).unwrap();
    }
    let bytes = zip.finish().unwrap().into_inner();
    let start = Instant::now();
    let mut pkg = Package::read(&bytes).unwrap();
    for i in 0..20000 {
        assert!(pkg.has(&format!("PARTS/{i}.XML")));
    }
    assert!(start.elapsed() < Duration::from_secs(2), "loading and lookups took {:?}", start.elapsed());
    pkg.remove("parts/0.xml");
    pkg.put("parts/new.xml", vec![1], "application/xml");
    assert!(!pkg.has("parts/0.xml"));
    assert_eq!(pkg.part("parts/19999.xml").unwrap(), &[]);
    assert_eq!(pkg.part("PARTS/NEW.XML").unwrap(), &[1]);
}

#[test]
fn relationship_allocation_scales_linearly() {
    use std::time::{Duration, Instant};
    let mut rels = office_core::opc::Relationships::default();
    let start = Instant::now();
    for i in 0..1200 {
        let id = rels.add(kind::HYPERLINK, format!("https://example.org/{i}"), true);
        assert_eq!(rels.get(&id).unwrap().target, format!("https://example.org/{i}"));
    }
    assert!(start.elapsed() < Duration::from_secs(1), "allocation took {:?}", start.elapsed());
    rels.remove("rId2");
    assert_eq!(rels.add(kind::IMAGE, "image.png", false), "rId2");
}

#[test]
fn package_clones_share_lazy_data_but_replace_independently() {
    let mut pkg = Package::new();
    pkg.put("bytes.bin", vec![42; 1024], "application/octet-stream");
    let pkg = Package::read(&pkg.to_bytes().unwrap()).unwrap();
    let mut copy = pkg.clone();
    assert_eq!(copy.part("bytes.bin").unwrap().as_ptr(), pkg.part("bytes.bin").unwrap().as_ptr());
    copy.replace("bytes.bin", vec![7]).unwrap();
    assert_eq!(copy.part("bytes.bin").unwrap(), &[7]);
    assert_eq!(pkg.part("bytes.bin").unwrap(), &[42; 1024]);
}

#[test]
fn escaped_part_names_round_trip_through_relationships() {
    use office_core::opc::names::{relative, resolve};
    for part in ["word/media/my%20picture.png", "word/media/a%23b%3F.png", "word/media/100%25.png", "word/media/%D1%86.png"] {
        let target = relative("word/document.xml", part);
        assert_eq!(resolve("word/document.xml", &target), part);
        assert!(!target.contains("%2520"));
    }
}

#[test]
fn relationship_indexes_follow_direct_mutation() {
    let mut rels = office_core::opc::Relationships::default();
    let id = rels.link("https://example.org/first");
    assert_eq!(rels.link("https://example.org/first"), id);
    rels.0[0].id = "rId2".into();
    rels.0[0].target = "https://example.org/second".into();
    assert!(rels.get(&id).is_none());
    assert_eq!(rels.link("https://example.org/second"), "rId2");
    assert_eq!(rels.link("https://example.org/first"), "rId1");
    rels.0.retain(|r| r.id != "rId2");
    assert!(rels.get("rId2").is_none());
    assert_eq!(rels.add(kind::IMAGE, "image.png", false), "rId2");
}
