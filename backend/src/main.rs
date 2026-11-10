mod features;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001").await?;
    println!("Mongotext backend running at http://127.0.0.1:3001");
    axum::serve(listener, features::routes()).await
}
