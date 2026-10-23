package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

func prepare(root string) error {
	return filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return os.Lchown(path, 1000, 1000)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("unsupported volume entry: %s", path)
		}
		if err := os.Lchown(path, 1000, 1000); err != nil {
			return err
		}
		mode := info.Mode().Perm() | 0600
		if info.IsDir() {
			mode |= 0100
		}
		return os.Chmod(path, mode)
	})
}

func main() {
	for _, root := range []string{"/volumes/0", "/volumes/1", "/volumes/2"} {
		if err := prepare(root); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
