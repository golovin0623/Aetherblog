import java.nio.file.Path;
import java.nio.file.Paths;

public class test_path {
    public static void main(String[] args) {
        String basePath = "./uploads";
        String path = "../../../etc/passwd";

        Path basePathObj = Paths.get(basePath).toAbsolutePath().normalize();
        Path resolvedPath = Paths.get(basePath).resolve(path).toAbsolutePath().normalize();

        System.out.println("basePathObj: " + basePathObj);
        System.out.println("resolvedPath: " + resolvedPath);
        System.out.println("startsWith: " + resolvedPath.startsWith(basePathObj));
    }
}
