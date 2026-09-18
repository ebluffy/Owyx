pluginManagement {
	repositories {
		// Prefer Google's Maven Central mirror — GitHub-hosted runners often hit
		// repo.maven.apache.org 429 (Too Many Requests) via plugins.gradle.org.
		maven {
			url = uri("https://maven-central.storage-download.googleapis.com/maven2/")
		}
		gradlePluginPortal()
		mavenCentral()
	}
}

plugins {
	// Apply the foojay-resolver plugin to allow automatic download of JDKs
	id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
	repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
	repositories {
		maven {
			url = uri("https://maven-central.storage-download.googleapis.com/maven2/")
		}
		mavenCentral()
	}
}

rootProject.name = "theseus"
