use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use lopdf::Document;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct PdfData {
    pub text: String,
    pub pages: u32,
    pub images: Vec<ExtractedImage>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractedImage {
    pub page_num: u32,
    pub caption: Option<String>,
    pub filename: String,
    pub data_base64: String,
}

pub fn parse_pdf(path: &str) -> Result<PdfData, String> {
    let document =
        Document::load(path).map_err(|e| format!("Failed to open PDF: {}", e))?;

    let pages = document.get_pages();
    let page_count = pages.len() as u32;

    let mut full_text = String::new();
    let mut all_images: Vec<ExtractedImage> = Vec::new();

    let figure_regex = Regex::new(r"(?i)(?:Figura|Figure)\s+(\d+(?:\.\d+)?)[.:]?\s*([^\n.]*)")
        .map_err(|e| format!("Regex error: {}", e))?;

    for (page_num, page_id) in pages.iter() {
        let page_num = *page_num;

        // Extract text from this page
        let page_text = document
            .extract_text(&[page_num])
            .map_err(|e| format!("Failed to extract text from page {}: {}", page_num, e))?;

        full_text.push_str(&page_text);
        full_text.push('\n');

        // Detect figure captions on this page
        let mut captions: Vec<String> = Vec::new();
        for cap in figure_regex.captures_iter(&page_text) {
            let figure_num = cap.get(1).map(|m| m.as_str()).unwrap_or("?");
            let caption_text = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
            let caption = if caption_text.is_empty() {
                format!("Figura {}", figure_num)
            } else {
                format!("Figura {}: {}", figure_num, caption_text)
            };
            captions.push(caption);
        }

        // Extract images from this page
        let page_images = document
            .get_page_images(*page_id)
            .map_err(|e| format!("Failed to get images from page {}: {}", page_num, e))?;

        for (img_idx, img) in page_images.iter().enumerate() {
            let mut content = img.content.to_vec();

            // Decompress if needed
            if let Some(filters) = &img.filters {
                if !filters.is_empty() {
                    let stream = lopdf::Stream::new(img.origin_dict.clone(), content.clone());
                    match stream.decompressed_content() {
                        Ok(decompressed) => content = decompressed,
                        Err(_) => {
                            // If decompression fails, try plain content
                            match stream.get_plain_content() {
                                Ok(plain) => content = plain,
                                Err(_) => {}
                            }
                        }
                    }
                }
            }

            // Determine file extension based on filters
            let ext = if let Some(filters) = &img.filters {
                if filters.iter().any(|f| f == "DCTDecode") {
                    "jpg"
                } else if filters.iter().any(|f| f == "JPXDecode") {
                    "jp2"
                } else {
                    "png"
                }
            } else {
                "png"
            };

            let data_base64 = BASE64.encode(&content);
            let filename = format!("page_{}_image_{}.{}", page_num, img_idx, ext);

            // Try to associate a caption with this image
            let caption = captions.get(img_idx).cloned();

            all_images.push(ExtractedImage {
                page_num,
                caption,
                filename,
                data_base64,
            });
        }
    }

    Ok(PdfData {
        text: full_text,
        pages: page_count,
        images: all_images,
    })
}
