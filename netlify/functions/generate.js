exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const BYTEPLUS_API_KEY = process.env.BYTEPLUS_API_KEY;
  const ENDPOINT = "https://ark.ap-southeast-1.bytepluses.com/api/v3/contents/generations/tasks";

  if (!BYTEPLUS_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API key not configured." }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { prompt, duration, mediaItems } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Prompt is required." }),
      };
    }

    // Build BytePlus content array — text first
    const content = [{ type: "text", text: prompt }];

    // Upload media to tmpfiles.org to get public URLs
    if (mediaItems && mediaItems.length > 0) {
      for (const item of mediaItems) {
        if (!item.dataUrl) continue;

        try {
          // Convert base64 to binary
          const base64Data = item.dataUrl.split(",")[1];
          const mimeType = item.mimeType || (item.type === "video" ? "video/mp4" : "image/jpeg");
          const ext = item.type === "video" ? "mp4" : "jpg";

          // Upload to tmpfiles.org (free, no auth needed, 24h expiry)
          const formData = `--boundary\r\nContent-Disposition: form-data; name="file"; filename="upload.${ext}"\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Data}\r\n--boundary--`;

          const uploadRes = await fetch("https://tmpfiles.org/api/v1/upload", {
            method: "POST",
            headers: {
              "Content-Type": "multipart/form-data; boundary=boundary",
            },
            body: formData,
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            // tmpfiles.org returns url like https://tmpfiles.org/1234/file.jpg
            // Direct download URL is https://tmpfiles.org/dl/1234/file.jpg
            const publicUrl = uploadData?.data?.url?.replace(
              "tmpfiles.org/",
              "tmpfiles.org/dl/"
            );

            if (publicUrl) {
              if (item.type === "image") {
                content.push({
                  type: "image_url",
                  image_url: { url: publicUrl },
                  role: "reference_image",
                });
              } else if (item.type === "video") {
                content.push({
                  type: "video_url",
                  video_url: { url: publicUrl },
                  role: "reference_video",
                });
              }
            }
          }
        } catch (uploadErr) {
          console.error("Upload error:", uploadErr.message);
          // Continue without this media item
        }
      }
    }

    const payload = {
      model: "dreamina-seedance-2-0-260128",
      content,
      generate_audio: true,
      ratio: "9:16",
      duration: duration || 15,
      watermark: false,
    };

    // Submit task to BytePlus
    const submitRes = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BYTEPLUS_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      return {
        statusCode: submitRes.status,
        body: JSON.stringify({ error: submitData.message || submitData.error || JSON.stringify(submitData) }),
      };
    }

    const taskId =
      submitData?.data?.task_id ||
      submitData?.task_id ||
      submitData?.id;

    if (!taskId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No task ID returned.", raw: submitData }),
      };
    }

    // Poll for result — max 3 minutes
    const pollUrl = `${ENDPOINT}/${taskId}`;
    let videoUrl = null;

    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${BYTEPLUS_API_KEY}` },
      });

      const pollData = await pollRes.json();
      const status =
        pollData?.data?.status ||
        pollData?.status ||
        pollData?.data?.task_status;

      if (["succeeded", "completed", "Success", "success"].includes(status)) {
        videoUrl =
          pollData?.data?.video_url ||
          pollData?.data?.output?.video_url ||
          pollData?.data?.videos?.[0]?.url ||
          pollData?.video_url;
        break;
      }

      if (["failed", "Failed", "error"].includes(status)) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Video generation failed.", raw: pollData }),
        };
      }
    }

    if (!videoUrl) {
      return {
        statusCode: 504,
        body: JSON.stringify({ error: "Video generation timed out. Try again." }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_url: videoUrl }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error: " + err.message }),
    };
  }
};
