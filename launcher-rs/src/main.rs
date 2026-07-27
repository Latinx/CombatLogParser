use std::env;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::thread;

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
    let mut buffer = [0_u8; 2048];
    let bytes_read = stream.read(&mut buffer)?;
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let path = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    if path == "/" || path == "/index.html" {
        write_response(&mut stream, "200 OK", "text/html; charset=utf-8", INDEX_HTML.as_bytes())
    } else {
        write_response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found")
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> std::io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(body)
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
