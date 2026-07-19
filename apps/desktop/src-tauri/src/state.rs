use fragment_core::FragmentCore;

pub struct FragmentState {
    pub core: FragmentCore,
}

impl FragmentState {
    pub fn new() -> Result<Self, fragment_core::CoreError> {
        let started_at = std::time::Instant::now();
        Ok(Self {
            core: FragmentCore::new()?,
        })
        .inspect(|_| {
            tracing::info!(
                elapsed_ms = started_at.elapsed().as_millis(),
                "initialized Fragment core"
            );
        })
    }
}
