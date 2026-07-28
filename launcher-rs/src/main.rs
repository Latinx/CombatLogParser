use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Seek, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::thread;
use std::time::Duration;

#[cfg(target_os = "windows")]
use rfd::FileDialog;

const INDEX_HTML: &str = include_str!("../../index.html");
const START_PORT: u16 = 8081;

fn main() -> std::io::Result<()> {
    let (listener, port) = bind_listener()?;
    let url = format!("http://127.0.0.1:{port}");
    println!("Combat Log Parser running at {url}");

    if env::var("COMBAT_LOG_PARSER_OPEN").unwrap_or_default() == "1" {
        open_browser(&url);
    }

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                thread::spawn(|| {
                    let _ = handle_client(stream);
                });
            }
            Err(err) => eprintln!("Connection failed: {err}"),
        }
    }

    Ok(())
}

fn bind_listener() -> std::io::Result<(TcpListener, u16)> {
    for port in START_PORT..=START_PORT + 20 {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(_) => continue,
        }
    }
    TcpListener::bind(("127.0.0.1", 0)).and_then(|listener| {
        let port = listener.local_addr()?.port();
        Ok((listener, port))
    })
}

fn handle_client(mut stream: TcpStream) -> std::io::Result<()> {
    let mut buffer = [0_u8; 4096];
    let bytes_read = stream.read(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let request_line = request.lines().next().unwrap_or("");
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");

    let (path_only, query_string) = if let Some(idx) = path.find('?') {
        (&path[..idx], Some(&path[idx + 1..]))
    } else {
        (path, None)
    };

    let query_params: HashMap<String, String> = query_string
        .unwrap_or("")
        .split('&')
        .filter(|s| !s.is_empty())
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?;
            let value = parts.next().unwrap_or("");
            Some((url_decode(key), url_decode(value)))
        })
        .collect();

    match path_only {
        "/api/pick-file" => handle_pick_file(&mut stream),
        "/api/monitor/watch" => {
            if let Some(file_path) = query_params.get("path") {
                handle_monitor_watch(&mut stream, file_path)
            } else {
                write_json(&mut stream, 400, "{\"error\":\"Missing path\"}")
            }
        }
        "/api/monitor/stop" => {
            write_json(&mut stream, 200, "{\"stopped\":true}")
        }
        "/api/character-profile" => handle_character_profile(&mut stream, &query_params),
        _ => {
            if path_only == "/" || path_only == "/index.html" {
                write_ok(&mut stream, "text/html; charset=utf-8", INDEX_HTML.as_bytes())
            } else {
                write_404(&mut stream)
            }
        }
    }
}

fn handle_character_profile(
    stream: &mut TcpStream,
    query_params: &HashMap<String, String>,
) -> std::io::Result<()> {
    let region = query_params.get("region").map(String::as_str).unwrap_or("");
    let realm = query_params.get("realm").map(String::as_str).unwrap_or("");
    let name = query_params.get("name").map(String::as_str).unwrap_or("");

    if !matches!(region, "us" | "eu" | "kr" | "tw")
        || !is_safe_profile_segment(realm)
        || !is_safe_profile_segment(name)
    {
        return write_json(stream, 400, "{\"error\":\"Invalid character identity\"}");
    }

    let locale = match region {
        "eu" => "en-gb",
        "kr" => "ko-kr",
        "tw" => "zh-tw",
        _ => "en-us",
    };
    let url = format!(
        "https://worldofwarcraft.blizzard.com/{locale}/character/{region}/{}/{}",
        percent_encode_path_segment(realm),
        percent_encode_path_segment(name)
    );
    let response = match minreq::get(&url)
        .with_header("User-Agent", "CombatLogParser/0.2")
        .with_timeout(12)
        .send()
    {
        Ok(response) => response,
        Err(_) => return write_json(stream, 502, "{\"error\":\"Profile lookup failed\"}"),
    };
    if response.status_code == 404 {
        return write_json(stream, 404, "{\"error\":\"Character not found\"}");
    }
    if response.status_code != 200 {
        return write_json(stream, 502, "{\"error\":\"Profile provider unavailable\"}");
    }

    let body = match response.as_str() {
        Ok(body) => body,
        Err(_) => return write_json(stream, 502, "{\"error\":\"Invalid profile response\"}"),
    };
    let profile = match extract_character_profile(body) {
        Ok(profile) => profile,
        Err(_) => return write_json(stream, 502, "{\"error\":\"Invalid profile JSON\"}"),
    };
    let Some(character) = profile.get("character") else {
        return write_json(stream, 404, "{\"error\":\"Character profile unavailable\"}");
    };
    let result = serde_json::json!({
        "provider": "blizzard-public-profile",
        "class": character.get("class"),
        "spec": character.get("spec"),
        "name": character.get("name"),
        "realm": character.get("realm"),
    });
    write_json(stream, 200, &result.to_string())
}

fn extract_character_profile(body: &str) -> Result<serde_json::Value, ()> {
    let marker = "var characterProfileInitialState = ";
    let start = body.find(marker).map(|index| index + marker.len()).ok_or(())?;
    let end = body[start..].find("</script>").map(|index| start + index).ok_or(())?;
    let payload = body[start..end].trim().strip_suffix(';').unwrap_or(body[start..end].trim());
    serde_json::from_str(payload).map_err(|_| ())
}

fn is_safe_profile_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_alphanumeric() || character == '-')
}

fn handle_pick_file(stream: &mut TcpStream) -> std::io::Result<()> {
    let path = pick_file_native();
    match path {
        Some(p) => {
            let json = format!("{{\"path\":\"{}\",\"cancelled\":false}}", json_escape(&p));
            write_json(stream, 200, &json)
        }
        None => write_json(stream, 200, "{\"path\":null,\"cancelled\":true}"),
    }
}

fn pick_file_native() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let file = FileDialog::new()
            .add_filter("Combat Logs", &["txt"])
            .set_title("Select WoW Combat Log")
            .pick_file();
        return file.map(|f| f.to_string_lossy().to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let result = Command::new("zenity")
            .args(["--file-selection", "--title", "Select WoW Combat Log", "--file-filter", "*.txt"])
            .output();
        if let Ok(out) = result {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
        None
    }
}

fn handle_monitor_watch(stream: &mut TcpStream, file_path: &str) -> std::io::Result<()> {
    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(_) => {
            return write_json(
                stream,
                404,
                &format!("{{\"error\":\"File not found\",\"path\":\"{}\"}}", json_escape(file_path)),
            );
        }
    };

    let mut file_size = metadata.len();

    // Write SSE response headers
    let intro = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: text/event-stream\r\n\
         Cache-Control: no-cache\r\n\
         Connection: keep-alive\r\n\
         Access-Control-Allow-Origin: *\r\n\
         \r\n\
         event: start\r\n\
         data: {}\n\n",
        format!("{{\"path\":\"{}\",\"fileSize\":{}}}", json_escape(file_path), file_size)
    );
    stream.write_all(intro.as_bytes())?;
    stream.flush()?;

    // Loop: check file size, send new lines, repeat
    let path = file_path.to_string();
    loop {
        thread::sleep(Duration::from_secs(2));

        let new_size = match fs::metadata(&path) {
            Ok(m) => m.len(),
            Err(_) => {
                let _ = stream.write_all(b"event: error\ndata: {\"error\":\"File lost\"}\n\n");
                let _ = stream.flush();
                break;
            }
        };

        if new_size <= file_size {
            continue;
        }

        let old_size = file_size;
        file_size = new_size;

        match read_range(&path, old_size, new_size) {
            Ok(new_text) => {
                let lines: Vec<&str> = new_text.split('\n').collect();
                let complete = if new_text.ends_with('\n') {
                    &lines
                } else {
                    &lines[..lines.len().saturating_sub(1)]
                };
                let lines_json: Vec<String> = complete
                    .iter()
                    .map(|l| format!("\"{}\"", json_escape(l)))
                    .collect();
                let event = format!(
                    "event: append\ndata: {{\"lines\":[{}],\"totalLines\":{}}}\n\n",
                    lines_json.join(","),
                    new_size
                );
                if stream.write_all(event.as_bytes()).is_err() {
                    break;
                }
                let _ = stream.flush();
            }
            Err(_) => break,
        }
    }

    Ok(())
}

fn read_range(path: &str, start: u64, end: u64) -> std::io::Result<String> {
    use std::io::SeekFrom;
    let mut file = fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let len = (end - start) as usize;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

fn write_json(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let s = match status {
        200 => "200 OK",
        400 => "400 Bad Request",
        404 => "404 Not Found",
        _ => "500 Internal Server Error",
    };
    write_raw(stream, s, "application/json", body.as_bytes())
}

fn write_ok(stream: &mut TcpStream, content_type: &str, body: &[u8]) -> std::io::Result<()> {
    write_raw(stream, "200 OK", content_type, body)
}

fn write_404(stream: &mut TcpStream) -> std::io::Result<()> {
    write_raw(stream, "404 Not Found", "text/plain", b"Not found")
}

fn write_raw(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
}

fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => decoded.push(b' '),
            b'%' if index + 2 < bytes.len() => {
                if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                    if let Ok(byte) = u8::from_str_radix(hex, 16) {
                        decoded.push(byte);
                        index += 2;
                    }
                }
            }
            byte => decoded.push(byte),
        }
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn percent_encode_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn json_escape(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => result.push_str("\\\""),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            _ => result.push(c),
        }
    }
    result
}

fn open_browser(url: &str) {
    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).spawn()
    };

    if let Err(err) = result {
        eprintln!("Could not open browser automatically: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_query_values() {
        assert_eq!(url_decode("T%C3%A1m-Arthas-US"), "Tám-Arthas-US");
    }

    #[test]
    fn extracts_character_profile_json() {
        let html = r#"<script>var characterProfileInitialState = {"character":{"class":{"id":6}}};
</script>"#;
        let profile = extract_character_profile(html).expect("profile should parse");
        assert_eq!(profile["character"]["class"]["id"], 6);
    }
}
