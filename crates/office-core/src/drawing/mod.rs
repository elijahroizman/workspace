//! DrawingML, the part of Office Open XML that Word, PowerPoint and Excel share: themes,
//! colors, and the shape properties of drawing objects.

pub mod color;
pub mod shape;
pub mod theme;

pub use color::{Color, ColorBase, Rgb, Rgba};
pub use shape::{Fill, Line, ShapeProps, Xfrm};
pub use theme::{FontScheme, FontSet, Theme};
