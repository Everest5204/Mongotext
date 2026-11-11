mod features;

fn main() -> std::io::Result<()> {
    let env_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(".env");

    match dotenvy::from_path(env_path) {
        Ok(()) => {}
        Err(error) if error.not_found() => {}
        Err(_) => {
            return Err(std::io::Error::other(
                "Could not load backend/.env. Check its format and permissions.",
            ));
        }
    }

    start_backend()
}

#[tokio::main]
async fn start_backend() -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001").await?;
    println!("Mongotext backend running at http://127.0.0.1:3001");
    axum::serve(listener, features::routes()).await
}