use std::path::{Component, Path, PathBuf};

#[cfg(not(target_os = "macos"))]
use directories::ProjectDirs;

use crate::errors::{CoreError, CoreResult};

#[derive(Debug, Clone)]
pub struct AppPaths {
    root: PathBuf,
}

impl AppPaths {
    pub fn discover() -> CoreResult<Self> {
        if let Some(path) = std::env::var_os("FRAGMENT_APP_DATA_DIR") {
            return Self::from_root(PathBuf::from(path));
        }

        #[cfg(target_os = "macos")]
        {
            let home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .ok_or_else(|| CoreError::InvalidInput("HOME is not set".to_string()))?;
            Self::from_root(home.join("Library/Application Support/Fragment"))
        }

        #[cfg(not(target_os = "macos"))]
        {
            let project_dirs = ProjectDirs::from("com", "Auto Scale Agency", "Fragment")
                .ok_or_else(|| {
                    CoreError::InvalidInput("could not resolve app data path".to_string())
                })?;
            Self::from_root(project_dirs.data_dir().to_path_buf())
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn default() -> CoreResult<Self> {
        Self::discover()
    }

    pub fn from_root(root: PathBuf) -> CoreResult<Self> {
        let paths = Self { root };
        paths.create_all()?;
        Ok(paths)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn db_path(&self) -> PathBuf {
        self.root.join("fragment.db")
    }

    pub fn originals_dir(&self) -> PathBuf {
        self.root.join("originals")
    }

    pub fn thumbnails_dir(&self) -> PathBuf {
        self.root.join("thumbnails")
    }

    pub fn previews_dir(&self) -> PathBuf {
        self.root.join("previews")
    }

    pub fn temp_dir(&self) -> PathBuf {
        self.root.join("temp")
    }

    pub fn logs_dir(&self) -> PathBuf {
        self.root.join("logs")
    }

    pub fn create_all(&self) -> CoreResult<()> {
        std::fs::create_dir_all(&self.root)?;
        std::fs::create_dir_all(self.originals_dir())?;
        std::fs::create_dir_all(self.thumbnails_dir())?;
        std::fs::create_dir_all(self.previews_dir())?;
        std::fs::create_dir_all(self.temp_dir())?;
        std::fs::create_dir_all(self.logs_dir())?;
        Ok(())
    }

    pub fn resolve_relative_path(&self, relative_path: &str) -> CoreResult<PathBuf> {
        let path = Path::new(relative_path);
        if path.is_absolute()
            || path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
        {
            return Err(CoreError::UnsafePath(path.to_path_buf()));
        }
        Ok(self.root.join(path))
    }

    pub fn to_relative_string(&self, path: &Path) -> CoreResult<String> {
        let relative = path
            .strip_prefix(&self.root)
            .map_err(|_| CoreError::UnsafePath(path.to_path_buf()))?;
        Ok(relative.to_string_lossy().replace('\\', "/"))
    }
}
