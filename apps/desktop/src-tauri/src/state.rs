use fragment_core::FragmentCore;

pub struct FragmentState {
    pub core: FragmentCore,
}

impl FragmentState {
    pub fn new() -> Result<Self, fragment_core::CoreError> {
        Ok(Self {
            core: FragmentCore::new()?,
        })
    }
}
