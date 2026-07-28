fn main() {
    #[cfg(windows)]
    {
        let _ = embed_resource::compile("resource.rc", embed_resource::NONE);
    }
}