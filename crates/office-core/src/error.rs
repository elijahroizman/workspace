use std::fmt;

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Everything that can go wrong reading or writing a document.
#[derive(Debug)]
pub enum Error {
    /// The bytes aren't a zip, or the zip is damaged.
    Zip(String),
    /// A part's XML doesn't parse.
    Xml { part: String, message: String },
    /// A part the format requires is missing (`word/document.xml`, `xl/workbook.xml`…).
    MissingPart(String),
    /// The file parses but breaks a rule of its format.
    Invalid(String),
    /// The bytes aren't any format the compiler reads.
    UnknownFormat,
    /// A layer's hook failed.
    Layer { layer: &'static str, message: String },
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Zip(m) => write!(f, "not a readable Office file: {m}"),
            Error::Xml { part, message } => write!(f, "{part}: {message}"),
            Error::MissingPart(p) => write!(f, "the file has no {p}"),
            Error::Invalid(m) => f.write_str(m),
            Error::UnknownFormat => f.write_str("not a Word, PowerPoint, Excel or CSV file"),
            Error::Layer { layer, message } => write!(f, "{layer}: {message}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<zip::result::ZipError> for Error {
    fn from(e: zip::result::ZipError) -> Self {
        Error::Zip(e.to_string())
    }
}
